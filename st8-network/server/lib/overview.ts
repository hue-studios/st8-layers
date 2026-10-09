import { readItems } from '@directus/sdk'
import type { NetworkOverview, NetworkRequest } from '../../shared/types/network'
import { type Edge, edgeTime, mutualsOf, otherOf, rows } from './edges'
import { networkPeople } from './people'
import { rankConnections } from './ranking'

// GET /api/connections: the member's whole network. The edges are read with the member's own token, so Directus
// decides what they may see (no quietly declined requests to their sender, no blocks to the blocked); the one addition
// is the sender's own declined requests, which they keep seeing as "requested".

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

const EDGE_FIELDS = ['id', 'requester', 'addressee', 'status', 'date_created', 'date_updated']

export async function readOverview(ctx: St8SocialContext): Promise<NetworkOverview> {
  const me = ctx.me
  const [visible, quiet] = await Promise.all([
    ctx.user.request(readItems('connections' as Loose, { fields: EDGE_FIELDS, limit: -1 } as Loose)) as Promise<Edge[]>,
    rows<Edge>('connections', { fields: EDGE_FIELDS, filter: { requester: { _eq: me }, status: { _eq: 'declined' } }, limit: -1 }),
  ])
  const edges = [...visible.filter((e) => !(e.status === 'declined' && e.requester === me)), ...quiet]
  const people = await networkPeople(edges.map((e) => otherOf(e, me)))

  const asRequest = (e: Edge, at: string): NetworkRequest | null => {
    const person = people.get(otherOf(e, me))
    return person ? { person, at } : null
  }
  const listOf = (filter: (e: Edge) => boolean, at: (e: Edge) => string) =>
    edges.filter(filter).map((e) => asRequest(e, at(e))).filter((r): r is NetworkRequest => !!r).sort((x, y) => Date.parse(y.at) - Date.parse(x.at))

  const accepted = edges.filter((e) => e.status === 'accepted' && people.has(otherOf(e, me)))
  const ids = accepted.map((e) => otherOf(e, me))
  const mutuals = await mutualsOf(me, ids, ids)
  const list = accepted.map((e) => ({ id: otherOf(e, me), since: edgeTime(e), mutuals: mutuals.get(otherOf(e, me))?.length ?? 0 }))
  const scores = await rankConnections(me, list)

  return {
    connections: list
      .map((c) => ({ person: people.get(c.id)!, since: c.since, mutuals: c.mutuals, score: Math.round((scores.get(c.id) ?? 0) * 1000) / 1000 }))
      .sort((x, y) => y.score - x.score || Date.parse(y.since) - Date.parse(x.since)),
    incoming: listOf((e) => e.status === 'pending' && e.addressee === me, (e) => e.date_created),
    outgoing: listOf((e) => (e.status === 'pending' || e.status === 'declined') && e.requester === me, (e) => e.date_created),
    blocked: listOf((e) => e.status === 'blocked' && e.requester === me, edgeTime),
  }
}
