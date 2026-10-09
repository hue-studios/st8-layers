import type { ReactionCounts, ReactionKey, SocialPerson, SocialTargetRef, ThreadSummary } from '../../shared/types/social'
import { bumpReaction } from '../../shared/utils/social'
import { type SocialContext, type SocialEvent, and, create, isUniqueViolation, notBlocked, one, rows, sys } from './core'
import { THREAD_FIELDS } from './counters'
import { resolvePeople } from './people'

// Threads: one row per target (unique_key "<collection>:<item>"), created on the first comment or reaction. Reads of
// counts for many targets take a fixed number of queries, however many targets there are.

export interface ThreadRow {
  id: string
  target_collection: string
  target_item: string
  version: number | null
  locked: boolean | null
  comment_count: number | null
  reaction_counts: ReactionCounts | null
}

export type Capability = 'comments' | 'reactions' | 'reports'

/** Parse and check a target from a request: registered, allowing `capability`, and visible to the viewer. 404s. */
export async function requireTarget(event: SocialEvent, ctx: SocialContext, ref: { collection?: unknown, item?: unknown }, capability: Capability) {
  const def = socialTarget(ref.collection)
  const item = typeof ref.item === 'number' ? String(ref.item) : ref.item
  if (!def || typeof item !== 'string' || !item || item.length > 64) throw createError({ statusCode: 400, message: 'Unknown target.' })
  if (!def[capability]) throw createError({ statusCode: 400, message: `${def.label[0]!.toUpperCase()}${def.label.slice(1)}s don’t take ${capability}.` })
  const visible = await def.visible([item], { event, viewer: ctx.me })
  if (!visible.has(item)) throw createError({ statusCode: 404, message: 'Not found' })
  return { def, collection: def.collection, item }
}

export const threadKey = (collection: string, item: string) => `${collection}:${item}`

export function findThread(collection: string, item: string) {
  return one<ThreadRow & { unique_key: string }>(sys(), 'threads', { fields: THREAD_FIELDS, filter: { unique_key: { _eq: threadKey(collection, item) } } })
}

/** The target's thread, created if it doesn't exist yet (a concurrent create loses to the unique key and re-reads). */
export async function getOrCreateThread(collection: string, item: string): Promise<ThreadRow> {
  const existing = await findThread(collection, item)
  if (existing) return existing
  try {
    return await create<ThreadRow>('threads', {
      unique_key: threadKey(collection, item),
      target_collection: collection,
      target_item: item,
      app: useSt8Social().app,
      comment_count: 0,
      reaction_counts: {},
      version: 0,
      locked: false,
    }, THREAD_FIELDS)
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    const again = await findThread(collection, item)
    if (!again) throw err
    return again
  }
}

const sum = (counts: ReactionCounts) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)

/** One `_or` filter matching every target in `refs` on `target_collection` / `target_item`. */
export function targetFilter(refs: SocialTargetRef[]): Record<string, unknown> {
  const byCollection = new Map<string, string[]>()
  for (const r of refs) byCollection.set(r.collection, [...(byCollection.get(r.collection) ?? []), r.item])
  return { _or: [...byCollection].map(([collection, items]) => ({ target_collection: { _eq: collection }, target_item: { _in: items } })) }
}

/**
 * Thread summaries for many targets, as the viewer sees them. Targets the viewer may not see, or that aren't
 * registered, are left out. Queries: one visibility check per collection, then threads, the viewer's reactions, recent
 * reactors, and (only when the viewer has blocks) the blocked members' reactions and comments to subtract.
 */
export async function summarize(event: SocialEvent, ctx: SocialContext, refs: SocialTargetRef[]): Promise<ThreadSummary[]> {
  // Visibility, one call per collection.
  const byCollection = new Map<string, string[]>()
  for (const r of refs) if (socialTarget(r.collection)) byCollection.set(r.collection, [...new Set([...(byCollection.get(r.collection) ?? []), r.item])])
  const visible: SocialTargetRef[] = []
  await Promise.all([...byCollection].map(async ([collection, items]) => {
    const ok = await socialTarget(collection)!.visible(items, { event, viewer: ctx.me })
    for (const item of items) if (ok.has(item)) visible.push({ collection, item })
  }))
  if (!visible.length) return []

  const filter = targetFilter(visible)
  const [threads, mine, recent] = await Promise.all([
    rows<ThreadRow>(ctx.user, 'threads', { fields: THREAD_FIELDS, filter, limit: -1 }),
    rows<{ target_collection: string, target_item: string, reaction: ReactionKey }>(ctx.user, 'reactions', {
      fields: ['target_collection', 'target_item', 'reaction'],
      filter: and(filter, { user: { _eq: ctx.me } }),
      limit: -1,
    }),
    rows<{ target_collection: string, target_item: string, user: string }>(ctx.user, 'reactions', {
      fields: ['target_collection', 'target_item', 'user'],
      filter: and(filter, notBlocked('user', ctx.blocked), { user: { _neq: ctx.me } }),
      sort: ['-date_created'],
      limit: Math.min(40 * visible.length, 400),
    }),
  ])

  // Blocked members' activity, subtracted from the counts this viewer sees.
  const hiddenReactions = new Map<string, ReactionCounts>()
  const hiddenComments = new Map<string, number>()
  if (ctx.blocked.length) {
    const [theirs, comments] = await Promise.all([
      rows<{ target_collection: string, target_item: string, reaction: ReactionKey }>(ctx.user, 'reactions', {
        fields: ['target_collection', 'target_item', 'reaction'],
        filter: and(filter, { user: { _in: ctx.blocked } }),
        limit: -1,
      }),
      threads.length
        ? rows<{ thread: string }>(ctx.user, 'comments', {
            fields: ['thread'],
            filter: { thread: { _in: threads.map((t) => t.id) }, author: { _in: ctx.blocked }, status: { _eq: 'published' } },
            limit: -1,
          })
        : Promise.resolve([]),
    ])
    for (const r of theirs) {
      const key = threadKey(r.target_collection, r.target_item)
      const counts = hiddenReactions.get(key) ?? {}
      counts[r.reaction] = (counts[r.reaction] ?? 0) + 1
      hiddenReactions.set(key, counts)
    }
    for (const c of comments) hiddenComments.set(c.thread, (hiddenComments.get(c.thread) ?? 0) + 1)
  }

  const reactorIds = new Map<string, string[]>()
  for (const r of recent) {
    const key = threadKey(r.target_collection, r.target_item)
    const list = reactorIds.get(key) ?? []
    if (list.length < 2 && !list.includes(r.user)) reactorIds.set(key, [...list, r.user])
  }
  const myReaction = new Map(mine.map((r) => [threadKey(r.target_collection, r.target_item), r.reaction]))
  const people = await resolvePeople([ctx.me, ...[...reactorIds.values()].flat()])
  const threadOf = new Map(threads.map((t) => [threadKey(t.target_collection, t.target_item), t]))

  return visible.map(({ collection, item }) => {
    const key = threadKey(collection, item)
    const t = threadOf.get(key)
    const def = socialTarget(collection)!
    let reactions: ReactionCounts = { ...(t?.reaction_counts ?? {}) }
    for (const [k, n] of Object.entries(hiddenReactions.get(key) ?? {})) reactions = bumpReaction(reactions, k as ReactionKey, -(n ?? 0))
    const mineKey = myReaction.get(key) ?? null
    const reactors: SocialPerson[] = [
      ...(mineKey && people.get(ctx.me) ? [people.get(ctx.me)!] : []),
      ...(reactorIds.get(key) ?? []).map((id) => people.get(id)).filter((p): p is SocialPerson => !!p),
    ].slice(0, 2)
    return {
      key,
      collection,
      item,
      thread: t?.id ?? null,
      version: t?.version ?? 0,
      locked: !!t?.locked,
      commentCount: Math.max(0, (t?.comment_count ?? 0) - (t ? (hiddenComments.get(t.id) ?? 0) : 0)),
      reactions,
      reactionTotal: sum(reactions),
      myReaction: mineKey,
      reactors,
      can: { comment: !!def.comments, react: !!def.reactions, report: !!def.reports },
    }
  })
}

export async function summarizeOne(event: SocialEvent, ctx: SocialContext, collection: string, item: string): Promise<ThreadSummary> {
  const [summary] = await summarize(event, ctx, [{ collection, item }])
  if (!summary) throw createError({ statusCode: 404, message: 'Not found' })
  return summary
}
