import { createItem, deleteItem, readItems, updateItem } from '@directus/sdk'
import type { ConnectionState } from '../../shared/types/network'

// The `connections` collection: one row per pair (`unique_key` = the two user ids sorted, joined by ':'), read and
// written with the server account. Members read their own rows through Directus (ST8 Social): pending and accepted
// both ways, a declined request only by the person who declined it, a block only by the blocker (`requester`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

export interface Edge {
  id: string
  unique_key: string
  requester: string
  addressee: string
  status: 'pending' | 'accepted' | 'declined' | 'blocked'
  date_created: string
  date_updated: string | null
}

const EDGE_FIELDS = ['id', 'unique_key', 'requester', 'addressee', 'status', 'date_created', 'date_updated']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUserId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

export const sys = () => getDirectus()

export async function rows<T>(collection: string, query: Record<string, unknown>): Promise<T[]> {
  return (await sys().request(readItems(collection as Loose, query as Loose))) as T[]
}

export async function createRow<T>(collection: string, data: Record<string, unknown>, fields: string[] = ['id']): Promise<T> {
  return (await sys().request(createItem(collection as Loose, data as Loose, { fields } as Loose))) as T
}

export async function updateRow(collection: string, id: string, data: Record<string, unknown>) {
  await sys().request(updateItem(collection as Loose, id as Loose, data as Loose, { fields: ['id'] } as Loose))
}

export async function deleteRow(collection: string, id: string) {
  await sys().request(deleteItem(collection as Loose, id as Loose))
}

/** Split a long id list so `_in` filters stay well inside URL limits. */
export function chunks<T>(list: T[], size = 60): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export const pairKey = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join(':')
export const otherOf = (edge: Pick<Edge, 'requester' | 'addressee'>, me: string) => (edge.requester === me ? edge.addressee : edge.requester)
export const edgeTime = (edge: Pick<Edge, 'date_created' | 'date_updated'>) => edge.date_updated ?? edge.date_created

/** The pair's edge, or null. */
export async function readEdge(a: string, b: string): Promise<Edge | null> {
  const [edge] = await rows<Edge>('connections', { fields: EDGE_FIELDS, filter: { unique_key: { _eq: pairKey(a, b) } }, limit: 1 })
  return edge ?? null
}

/** `me`'s edges with each of `ids` (keyed by the other id). */
export async function edgesBetween(me: string, ids: string[]): Promise<Map<string, Edge>> {
  const out = new Map<string, Edge>()
  const keys = [...new Set(ids.filter((id) => isUserId(id) && id !== me))].map((id) => pairKey(me, id))
  for (const part of chunks(keys)) {
    const list = await rows<Edge>('connections', { fields: EDGE_FIELDS, filter: { unique_key: { _in: part } }, limit: -1 })
    for (const edge of list) out.set(otherOf(edge, me), edge)
  }
  return out
}

/** Every edge touching `me`, any status. */
export async function edgesOf(me: string): Promise<Edge[]> {
  return rows<Edge>('connections', {
    fields: EDGE_FIELDS,
    filter: { _or: [{ requester: { _eq: me } }, { addressee: { _eq: me } }] },
    sort: ['-date_updated', '-date_created'],
    limit: -1,
  })
}

/**
 * How `me` stands with the other person on `edge`. `hidden`: they blocked me (callers treat it as "no such member").
 * A request the other person declined still reads as `outgoing` to its sender: declines are quiet.
 */
export function stateFor(me: string, edge: Edge | null): ConnectionState | 'hidden' {
  if (!edge) return 'none'
  switch (edge.status) {
    case 'accepted':
      return 'connected'
    case 'pending':
      return edge.requester === me ? 'outgoing' : 'incoming'
    case 'declined':
      return edge.requester === me ? 'outgoing' : 'none'
    case 'blocked':
      return edge.requester === me ? 'blocked' : 'hidden'
  }
}

/** `me`'s accepted connections: the other id and when the connection was made, most recent first. */
export async function acceptedNeighbours(me: string): Promise<{ id: string, since: string }[]> {
  const list = await rows<Edge>('connections', {
    fields: ['requester', 'addressee', 'date_created', 'date_updated'],
    filter: { status: { _eq: 'accepted' }, _or: [{ requester: { _eq: me } }, { addressee: { _eq: me } }] },
    sort: ['-date_updated'],
    limit: -1,
  })
  return list.map((e) => ({ id: otherOf(e, me), since: edgeTime(e) }))
}

/** Accepted edges between anyone in `a` and anyone in `b`. */
async function acceptedAcross(a: string[], b: string[]): Promise<Pick<Edge, 'requester' | 'addressee'>[]> {
  if (!a.length || !b.length) return []
  const out: Pick<Edge, 'requester' | 'addressee'>[] = []
  for (const left of chunks(a, 40)) {
    for (const right of chunks(b, 40)) {
      out.push(...await rows<Edge>('connections', {
        fields: ['requester', 'addressee'],
        filter: {
          status: { _eq: 'accepted' },
          _or: [
            { _and: [{ requester: { _in: left } }, { addressee: { _in: right } }] },
            { _and: [{ addressee: { _in: left } }, { requester: { _in: right } }] },
          ],
        },
        limit: -1,
      }))
    }
  }
  return out
}

/** For each of `ids`: the people connected to both them and `me`. */
export async function mutualsOf(me: string, ids: string[], mine?: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  const myConnections = mine ?? (await acceptedNeighbours(me)).map((n) => n.id)
  const targets = ids.filter((id) => id !== me)
  const mineSet = new Set(myConnections)
  for (const edge of await acceptedAcross(targets, myConnections)) {
    // An edge between two of my connections counts for both ends.
    for (const [x, y] of [[edge.requester, edge.addressee], [edge.addressee, edge.requester]] as const) {
      if (out.has(x) && mineSet.has(y) && y !== x) out.get(x)!.push(y)
    }
  }
  for (const [id, list] of out) out.set(id, [...new Set(list)])
  return out
}

/** Connections of my connections who aren't me or already on an edge with me, with how many of my connections know them. */
export async function secondDegree(me: string): Promise<Map<string, number>> {
  const [mine, all] = await Promise.all([acceptedNeighbours(me), edgesOf(me)])
  const near = new Set([me, ...all.map((e) => otherOf(e, me))])
  const counts = new Map<string, number>()
  const ids = mine.map((n) => n.id)
  for (const part of chunks(ids, 40)) {
    const list = await rows<Edge>('connections', {
      fields: ['requester', 'addressee'],
      filter: { status: { _eq: 'accepted' }, _or: [{ requester: { _in: part } }, { addressee: { _in: part } }] },
      limit: -1,
    })
    const partSet = new Set(part)
    for (const edge of list) {
      for (const [via, other] of [[edge.requester, edge.addressee], [edge.addressee, edge.requester]] as const) {
        if (partSet.has(via) && !near.has(other)) counts.set(other, (counts.get(other) ?? 0) + 1)
      }
    }
  }
  return counts
}
