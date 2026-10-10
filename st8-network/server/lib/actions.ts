import type { ConnectionAction, ConnectionResult, ConnectionState } from '../../shared/types/network'
import { type Edge, acceptedNeighbours, createRow, deleteRow, edgesOf, isUserId, pairKey, readEdge, rows, stateFor, updateRow } from './edges'

// Every change to the graph: request, accept, decline, cancel, remove, block, unblock, intro. Each one runs under a lock
// on the pair (one server instance can't race itself) and re-reads the pair's edge inside it; a create that loses a
// race to another instance hits the unique key, re-reads and carries on from the edge that won. Blocks are hidden from
// the blocked member: anything they try across one reads as "no such member".

type Ctx = St8SocialContext
type H3Event = Parameters<typeof getRequestIP>[0]

const notFound = () => createError({ statusCode: 404, message: 'Member not found.' })
const userTarget = (id: string) => ({ collection: 'directus_users', item: id })
const cooldownKey = (me: string, other: string) => `network:withdrawn:${me}:${other}`

/** The other member must be an active member of this app, not me, not across a block. */
async function requireReachable(ctx: Ctx, other: unknown): Promise<string> {
  if (!isUserId(other)) throw createError({ statusCode: 400, message: 'Pick a member.' })
  const id = other.toLowerCase()
  if (id === ctx.me) throw createError({ statusCode: 400, message: 'That’s you.' })
  if (ctx.blocked.includes(id)) throw notFound()
  if (!(await st8SocialServer.activeMembers([id])).has(id)) throw notFound()
  return id
}

function withPair<T>(a: string, b: string, fn: () => Promise<T>): Promise<T> {
  return st8SocialServer.withLock(`network:${pairKey(a, b)}`, fn)
}

/** Create the pair's edge; false when another instance created one first, so the caller re-reads. */
async function createEdge(requester: string, addressee: string, status: Edge['status']): Promise<boolean> {
  try {
    await createRow('connections', { unique_key: pairKey(requester, addressee), requester, addressee, status, app: useSt8Network().app })
    return true
  } catch (err) {
    if (st8SocialServer.isUniqueViolation(err)) return false
    throw err
  }
}

async function readCooldown(me: string, other: string): Promise<number | null> {
  try {
    const until = await useStorage<number>('st8-network-cooldown').getItem(cooldownKey(me, other))
    return typeof until === 'number' && until > Date.now() ? until : null
  } catch {
    return null
  }
}

async function startCooldown(me: string, other: string) {
  const ms = useSt8Network().withdrawCooldownMs
  try {
    await useStorage<number>('st8-network-cooldown').setItem(cooldownKey(me, other), Date.now() + ms, { ttl: Math.ceil(ms / 1000) })
  } catch (err) {
    console.warn('[st8-network] cooldown not stored:', (err as Error)?.message ?? err)
  }
}

async function accepted(ctx: Ctx, edge: Edge, requester: string) {
  await updateRow('connections', edge.id, { status: 'accepted' })
  await st8SocialServer.markNotificationsRead({ recipient: { _eq: ctx.me }, actor: { _eq: requester }, type: { _eq: 'connection_request' } })
  await st8SocialServer.notify(ctx, [{ recipient: requester, actor: ctx.me, type: 'connection_accepted', target: userTarget(ctx.me), data: {} }])
}

/** Ask to connect. Asking someone who already asked you connects you both. */
export async function requestConnection(event: H3Event, ctx: Ctx, otherInput: unknown): Promise<ConnectionResult> {
  const other = await requireReachable(ctx, otherInput)
  await networkRateLimit(event, ctx.me, 'requests', 'You’ve sent a lot of connection requests today.')
  const state = await withPair(ctx.me, other, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const edge = await readEdge(ctx.me, other)
      const now = stateFor(ctx.me, edge)
      if (now === 'hidden') throw notFound()
      if (now === 'connected' || now === 'outgoing') return now // a quietly declined request stays "requested"
      if (now === 'blocked') throw createError({ statusCode: 409, message: 'Unblock them first.' })
      if (edge && edge.requester === other && (edge.status === 'pending' || edge.status === 'declined')) {
        // They asked me (even if I declined it then): mutual intent.
        await accepted(ctx, edge, other)
        return 'connected' as const
      }
      // No edge (or one I declined and they never re-asked: the same as none for me).
      const until = await readCooldown(ctx.me, other)
      if (until) {
        throw createError({ statusCode: 429, message: `You withdrew a request to them recently. You can ask again after ${new Date(until).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.` })
      }
      const open = (await edgesOf(ctx.me)).filter((e) => e.requester === ctx.me && (e.status === 'pending' || e.status === 'declined')).length
      if (open >= useSt8Network().maxOutgoing) throw createError({ statusCode: 429, message: 'You have a lot of requests waiting. Withdraw some before sending more.' })
      if (await createEdge(ctx.me, other, 'pending')) {
        await st8SocialServer.notify(ctx, [{ recipient: other, actor: ctx.me, type: 'connection_request', target: userTarget(ctx.me), data: {} }])
        return 'outgoing' as const
      }
    }
    throw createError({ statusCode: 409, message: 'That changed while you were asking. Try again.' })
  })
  return { user: other, state }
}

/** Answer, withdraw or end a connection with `other`. */
export async function respond(event: H3Event, ctx: Ctx, otherInput: unknown, action: ConnectionAction): Promise<ConnectionResult> {
  if (!isUserId(otherInput)) throw createError({ statusCode: 400, message: 'Pick a member.' })
  const other = otherInput.toLowerCase()
  if (other === ctx.me) throw createError({ statusCode: 400, message: 'That’s you.' })
  await networkRateLimit(event, ctx.me, 'responses', 'That’s a lot of changes.')
  const state = await withPair(ctx.me, other, async (): Promise<ConnectionState> => {
    const edge = await readEdge(ctx.me, other)
    const fromThem = !!edge && edge.requester === other
    switch (action) {
      case 'accept':
        if (edge?.status === 'accepted') return 'connected'
        if (edge?.status !== 'pending' || !fromThem) throw createError({ statusCode: 404, message: 'There’s no request from them.' })
        await accepted(ctx, edge, other)
        return 'connected'
      case 'decline':
        if (edge?.status === 'declined' && fromThem) return 'none'
        if (edge?.status !== 'pending' || !fromThem) throw createError({ statusCode: 404, message: 'There’s no request from them.' })
        // Quiet: the sender isn't told and still sees "requested".
        await updateRow('connections', edge.id, { status: 'declined' })
        await st8SocialServer.markNotificationsRead({ recipient: { _eq: ctx.me }, actor: { _eq: other }, type: { _eq: 'connection_request' } })
        return 'none'
      case 'cancel':
        if (!edge || edge.requester !== ctx.me || (edge.status !== 'pending' && edge.status !== 'declined')) {
          throw createError({ statusCode: 404, message: 'There’s no request to withdraw.' })
        }
        await deleteRow('connections', edge.id)
        await st8SocialServer.withdrawNotifications({ recipient: { _eq: other }, actor: { _eq: ctx.me }, type: { _eq: 'connection_request' } })
        await startCooldown(ctx.me, other)
        return 'none'
      case 'remove':
        if (edge?.status !== 'accepted') throw createError({ statusCode: 404, message: 'You aren’t connected.' })
        await deleteRow('connections', edge.id)
        return 'none'
    }
  })
  return { user: other, state }
}

/**
 * Block or unblock. A block replaces the pair's edge with one `blocked` row whose requester is the blocker (a new row,
 * so the other member's live views see the old one deleted) and withdraws unread connection notifications between
 * them. Only the blocker can undo it, and undoing it restores nothing.
 */
export async function setBlocked(event: H3Event, ctx: Ctx, otherInput: unknown, blocked: boolean): Promise<ConnectionResult> {
  if (!isUserId(otherInput)) throw createError({ statusCode: 400, message: 'Pick a member.' })
  const other = otherInput.toLowerCase()
  if (other === ctx.me) throw createError({ statusCode: 400, message: 'That’s you.' })
  await networkRateLimit(event, ctx.me, 'blocks', 'That’s a lot of blocking today.')
  const state = await withPair(ctx.me, other, async (): Promise<ConnectionState> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const edge = await readEdge(ctx.me, other)
      const now = stateFor(ctx.me, edge)
      if (now === 'hidden') throw notFound()
      if (!blocked) {
        if (now !== 'blocked') throw createError({ statusCode: 404, message: 'You haven’t blocked them.' })
        await deleteRow('connections', edge!.id)
        return 'none'
      }
      if (now === 'blocked') return 'blocked'
      // Anyone I can see, or anyone already on an edge with me.
      if (!edge && !(await st8SocialServer.activeMembers([other])).has(other)) throw notFound()
      if (edge) await deleteRow('connections', edge.id)
      if (await createEdge(ctx.me, other, 'blocked')) {
        const types = { _in: ['connection_request', 'connection_accepted', 'intro'] }
        await st8SocialServer.withdrawNotifications({ recipient: { _eq: other }, actor: { _eq: ctx.me }, type: types })
        await st8SocialServer.withdrawNotifications({ recipient: { _eq: ctx.me }, actor: { _eq: other }, type: types })
        return 'blocked'
      }
    }
    throw createError({ statusCode: 409, message: 'That changed while you were blocking. Try again.' })
  }).finally(() => st8SocialServer.forgetBlocks(ctx.me, other))
  return { user: other, state }
}

const NOTE_MAX = 300

/** Clean an intro note: plain text, one paragraph's worth, ≤300 characters. Null when empty. */
export function introNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, message: 'The note must be text.' })
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length > NOTE_MAX) throw createError({ statusCode: 400, message: `Keep the note under ${NOTE_MAX} characters.` })
  return text || null
}

/**
 * Introduce two of my connections. Both get an `intro` notification pointing at the other; no edge is made, so either
 * can send a request or ignore it. Across a block between them it reports success and notifies nobody, so a block is
 * never revealed to a third person.
 */
export async function introduce(event: H3Event, ctx: Ctx, aInput: unknown, bInput: unknown, noteInput: unknown) {
  if (!isUserId(aInput) || !isUserId(bInput)) throw createError({ statusCode: 400, message: 'Pick two of your connections.' })
  const a = aInput.toLowerCase()
  const b = bInput.toLowerCase()
  if (a === b || a === ctx.me || b === ctx.me) throw createError({ statusCode: 400, message: 'Pick two different connections.' })
  const note = introNote(noteInput)
  await networkRateLimit(event, ctx.me, 'intros', 'You’ve made a lot of introductions today.')

  const mine = new Set((await acceptedNeighbours(ctx.me)).map((n) => n.id))
  if (!mine.has(a) || !mine.has(b)) throw createError({ statusCode: 403, message: 'Both people must be your connections.' })
  const active = await st8SocialServer.activeMembers([a, b])
  if (!active.has(a) || !active.has(b)) throw createError({ statusCode: 404, message: 'One of them isn’t a member here.' })

  const edge = await readEdge(a, b)
  if (edge?.status === 'accepted') throw createError({ statusCode: 409, message: 'They’re already connected.' })
  if (edge?.status === 'blocked') return { ok: true, already: false }

  const since = new Date(Date.now() - useSt8Network().introRepeatMs).toISOString()
  const [recent] = await rows<{ id: string }>('notifications', {
    fields: ['id'],
    filter: { type: { _eq: 'intro' }, actor: { _eq: ctx.me }, recipient: { _eq: a }, target_item: { _eq: b }, date_created: { _gte: since } },
    limit: 1,
  })
  if (recent) return { ok: true, already: true }

  await st8SocialServer.notify(ctx, [
    { recipient: a, actor: ctx.me, type: 'intro', target: userTarget(b), data: { with: b, snippet: note } },
    { recipient: b, actor: ctx.me, type: 'intro', target: userTarget(a), data: { with: a, snippet: note } },
  ])
  return { ok: true, already: false }
}

