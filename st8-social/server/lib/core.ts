import { aggregate, createItem, deleteItem, readItem, readItems, updateItem } from '@directus/sdk'

// Internals of the st8-social server: the Directus helpers every route uses, the per-key lock, rate limits and the
// viewer context. server/lib isn't auto-imported, so these generic names stay out of the host's namespace. Directus is reached only through the host's getDirectus() (the scoped server account) and st8-auth's
// getUserClient(event) (the member's own token, so their policies decide what they can read).

/** h3's event (h3 comes with Nitro; it isn't a direct dependency). */
export type SocialEvent = Parameters<typeof getRequestIP>[0]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isSocialId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

// ── Directus, loosely typed ────────────────────────────────────────────────────────────────────────────────────
// The layer can't know the host's generated schema, and these collections are the documented contract, so the
// helpers take plain objects and return plain rows.

type Client = ReturnType<typeof getDirectus>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

export const sys = (): Client => getDirectus()

export async function rows<T>(client: Client, collection: string, query: Record<string, unknown>): Promise<T[]> {
  return (await client.request(readItems(collection as Loose, query as Loose))) as T[]
}

export async function one<T>(client: Client, collection: string, query: Record<string, unknown>): Promise<T | null> {
  const [row] = await rows<T>(client, collection, { ...query, limit: 1 })
  return row ?? null
}

export async function byId<T>(client: Client, collection: string, id: string, fields: string[]): Promise<T | null> {
  try {
    return (await client.request(readItem(collection as Loose, id as Loose, { fields } as Loose))) as T
  } catch (err) {
    const { status } = directusError(err)
    if (status === 403 || status === 404) return null
    throw err
  }
}

export async function create<T>(collection: string, data: Record<string, unknown>, fields: string[] = ['*']): Promise<T> {
  return (await sys().request(createItem(collection as Loose, data as Loose, { fields } as Loose))) as T
}

export async function update<T>(collection: string, id: string, data: Record<string, unknown>, fields: string[] = ['id']): Promise<T> {
  return (await sys().request(updateItem(collection as Loose, id as Loose, data as Loose, { fields } as Loose))) as T
}

export async function remove(collection: string, id: string) {
  await sys().request(deleteItem(collection as Loose, id as Loose))
}

/** `count(*)` per group, e.g. `{ like: 3 }`. Directus may return counts as strings; they come back as numbers. */
export async function countBy(client: Client, collection: string, groupBy: string, filter: Record<string, unknown>): Promise<Record<string, number>> {
  const result = (await client.request(aggregate(collection as Loose, { aggregate: { count: '*' }, groupBy: [groupBy], query: { filter } } as Loose))) as Record<string, unknown>[]
  const out: Record<string, number> = {}
  for (const row of result) {
    const key = row[groupBy]
    const n = Number((row.count as Record<string, unknown> | number | string) && typeof row.count === 'object' ? (row.count as Record<string, unknown>)['*'] : row.count)
    if (key !== null && key !== undefined && n > 0) out[String(key)] = n
  }
  return out
}

export async function count(client: Client, collection: string, filter: Record<string, unknown>): Promise<number> {
  const [row] = (await client.request(aggregate(collection as Loose, { aggregate: { count: '*' }, query: { filter } } as Loose))) as Record<string, unknown>[]
  const value = row?.count
  return Number(value && typeof value === 'object' ? (value as Record<string, unknown>)['*'] : value) || 0
}

/** True when Directus refused a create because a unique column already holds the value. */
export function isUniqueViolation(err: unknown) {
  const { code, message } = directusError(err)
  return code === 'RECORD_NOT_UNIQUE' || /unique/i.test(message ?? '')
}

// ── Lock ───────────────────────────────────────────────────────────────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>()

/**
 * Run `fn` after every earlier call with the same key has finished (in this server instance). Counters don't rely on
 * it for correctness (they recount and verify, see social-counters.ts); it only stops one instance racing itself.
 */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  locks.set(key, tail)
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key)
  })
  return run
}

// ── Rate limits ────────────────────────────────────────────────────────────────────────────────────────────────

interface RateWindow { count: number, reset: number }

/**
 * Fixed-window limit per member, in the 'st8-social-rate-limit' storage mount (memory per instance unless the host
 * mounts a shared driver). 429 with Retry-After once `bucket` passes its limit. A storage failure never blocks.
 */
export async function socialRateLimit(event: SocialEvent, userId: string, bucket: keyof ReturnType<typeof useSt8Social>['limits'], message: string) {
  const [max, windowSec] = useSt8Social().limits[bucket]
  const storage = useStorage<RateWindow>('st8-social-rate-limit')
  const key = `${bucket}:${userId}`
  const now = Date.now()
  let current: RateWindow
  try {
    // Serialised per key in this instance, so parallel requests can't both read the same count.
    current = await withLock(`rate:${key}`, async () => {
      const stored = await storage.getItem(key)
      const next = stored && stored.reset > now ? { count: stored.count + 1, reset: stored.reset } : { count: 1, reset: now + windowSec * 1000 }
      await storage.setItem(key, next, { ttl: windowSec })
      return next
    })
  } catch (err) {
    console.warn('[st8-social] rate-limit storage failed; not counting:', (err as Error)?.message ?? err)
    return
  }
  if (current.count > max) {
    const retryAfter = Math.max(1, Math.ceil((current.reset - now) / 1000))
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, data: { retryAfter }, message: `${message} Try again in ${retryAfter} seconds.` })
  }
}

// ── Viewer ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SocialContext {
  me: string
  /** Directus as the member (their policies decide what reads return). */
  user: Client
  /** Members on the other side of a block, either direction. Their comments and reactions are hidden from me. */
  blocked: string[]
  /** memberships.role is one of the moderator roles (re-read from Directus, not the session). */
  isModerator: () => Promise<boolean>
}

/**
 * The signed-in member, checked: a session with an active membership in this app (403 otherwise). Cached on the
 * event, so a route can call it freely.
 */
export async function socialContext(event: SocialEvent): Promise<SocialContext> {
  const cached = event.context.st8Social as SocialContext | undefined
  if (cached) return cached
  const { me, directus } = await getUserClient(event)
  const membership = await getSessionMembership(event)
  if (membership?.status !== 'active') throw createError({ statusCode: 403, message: 'Only active members can do that.' })

  let moderator: Promise<boolean> | null = null
  const ctx: SocialContext = {
    me,
    user: directus,
    blocked: await blockedWith(me),
    isModerator: () => (moderator ??= readMembership(me, useSt8Social().app).then((m) => m?.status === 'active' && useSt8Social().moderatorRoles.includes(m.role))),
  }
  event.context.st8Social = ctx
  return ctx
}

export async function requireModerator(ctx: SocialContext) {
  if (!(await ctx.isModerator())) throw createError({ statusCode: 403, message: 'Only moderators can do that.' })
}

/** Ids of everyone with a `blocked` connection to `userId`, in either direction. */
export async function blockedWith(userId: string): Promise<string[]> {
  const edges = await rows<{ requester: string | null, addressee: string | null }>(sys(), 'connections', {
    fields: ['requester', 'addressee'],
    filter: { status: { _eq: 'blocked' }, _or: [{ requester: { _eq: userId } }, { addressee: { _eq: userId } }] },
    limit: -1,
  })
  return [...new Set(edges.map((e) => (e.requester === userId ? e.addressee : e.requester)).filter((id): id is string => !!id))]
}

/** A filter that drops rows whose `field` (a user) is blocked; `{}` when nobody is. Null users stay. */
export function notBlocked(field: string, blocked: string[]): Record<string, unknown> {
  if (!blocked.length) return {}
  return { _or: [{ [field]: { _null: true } }, { [field]: { _nin: blocked } }] }
}

/** Combine filters, skipping empty ones. */
export function and(...filters: Record<string, unknown>[]): Record<string, unknown> {
  const parts = filters.filter((f) => Object.keys(f).length)
  return parts.length === 1 ? parts[0]! : { _and: parts }
}

/** Read the JSON body, or a 400. */
export async function readJson<T extends Record<string, unknown>>(event: SocialEvent): Promise<Partial<T>> {
  const body = await readBody<unknown>(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: 'Expected a JSON object.' })
  return body as Partial<T>
}

export const noStore = (event: SocialEvent) => setResponseHeader(event, 'Cache-Control', 'private, no-store')
