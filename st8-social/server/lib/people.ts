import { readUsers } from '@directus/sdk'
import type { SocialPerson } from '../../shared/types/social'
import { type SocialContext, rows, sys } from './core'

// Members as the social components show them. Read with the server account (members can't read other users), and
// only ever for ids the caller already saw on a row it may read, so nothing here widens who can see whom. Never an
// email.

interface UserRow { id: string, first_name: string | null, last_name: string | null, avatar: string | null, title: string | null, status?: string }

const nameOf = (u: { first_name: string | null, last_name: string | null }) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Member'

/** People by id, with their profile accent colour (the global profile's industry). Unknown ids are left out. */
export async function resolvePeople(ids: Iterable<string | null | undefined>): Promise<Map<string, SocialPerson>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))]
  const out = new Map<string, SocialPerson>()
  if (!wanted.length) return out
  const [users, profiles] = await Promise.all([
    sys().request(readUsers({ fields: ['id', 'first_name', 'last_name', 'avatar', 'title'], filter: { id: { _in: wanted } }, limit: -1 })) as Promise<UserRow[]>,
    rows<{ user: string, industry: { color: string | null } | null }>(sys(), 'profiles', {
      fields: ['user', { industry: ['color'] }],
      filter: { user: { _in: wanted } },
      limit: -1,
    }),
  ])
  const colour = new Map(profiles.map((p) => [String(p.user), p.industry?.color ?? null]))
  for (const u of users) {
    out.set(u.id, {
      id: u.id,
      name: nameOf(u),
      first_name: u.first_name,
      last_name: u.last_name,
      avatar: typeof u.avatar === 'string' ? u.avatar : null,
      color: colour.get(u.id) ?? null,
      title: u.title ?? null,
    })
  }
  return out
}

/** The ids among `ids` that are active accounts with an active membership in this app. */
export async function activeMembers(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const [users, memberships] = await Promise.all([
    sys().request(readUsers({ fields: ['id'], filter: { id: { _in: ids }, status: { _eq: 'active' } }, limit: -1 })) as Promise<{ id: string }[]>,
    rows<{ user: string }>(sys(), 'memberships', {
      fields: ['user'],
      filter: { user: { _in: ids }, app: { _eq: useSt8Social().app }, status: { _eq: 'active' } },
      limit: -1,
    }),
  ])
  const member = new Set(memberships.map((m) => String(m.user)))
  return new Set(users.map((u) => u.id).filter((id) => member.has(id)))
}

/**
 * Who a body may mention: active members of this app, not the author, not blocked either way. A member can open any
 * active member's profile by id, so this is the same rule; the autocomplete below lists fewer people.
 */
export async function mentionable(ctx: SocialContext, ids: string[]): Promise<string[]> {
  const candidates = ids.filter((id) => id !== ctx.me && !ctx.blocked.includes(id))
  const ok = await activeMembers(candidates)
  return candidates.filter((id) => ok.has(id))
}

/**
 * Mention autocomplete. Listing people follows the profile rule (`discoverable` gates listing and search), so it
 * offers members who are discoverable, accepted connections, and people already commenting on this thread (the viewer
 * can see them there), in that order of preference: participants and connections first. Never blocked members or
 * the viewer.
 */
export async function searchMentions(ctx: SocialContext, query: string, threadId: string | null): Promise<SocialPerson[]> {
  const q = query.trim().replace(/^@/, '').slice(0, 40)
  const nameFilter = q
    ? { _or: q.split(/\s+/).filter(Boolean).slice(0, 2).flatMap((part) => [{ first_name: { _istarts_with: part } }, { last_name: { _istarts_with: part } }]) }
    : {}
  const exclude = [ctx.me, ...ctx.blocked]

  const [participants, connections] = await Promise.all([
    threadId
      ? rows<{ author: string | null }>(ctx.user, 'comments', { fields: ['author'], filter: { thread: { _eq: threadId }, status: { _eq: 'published' } }, sort: ['-date_created'], limit: 200 })
      : Promise.resolve([]),
    rows<{ requester: string, addressee: string }>(sys(), 'connections', {
      fields: ['requester', 'addressee'],
      filter: { status: { _eq: 'accepted' }, _or: [{ requester: { _eq: ctx.me } }, { addressee: { _eq: ctx.me } }] },
      limit: -1,
    }),
  ])
  const preferred = new Set([
    ...participants.map((p) => p.author),
    ...connections.map((c) => (c.requester === ctx.me ? c.addressee : c.requester)),
  ].filter((id): id is string => !!id && !exclude.includes(id)))

  // Candidates by name: preferred people, plus discoverable profiles.
  const [named, discoverable] = await Promise.all([
    preferred.size
      ? sys().request(readUsers({ fields: ['id'], filter: { _and: [{ id: { _in: [...preferred] } }, nameFilter].filter((f) => Object.keys(f).length) }, limit: 50 })) as Promise<{ id: string }[]>
      : Promise.resolve([]),
    rows<{ user: { id: string } | null }>(sys(), 'profiles', {
      fields: [{ user: ['id'] }],
      filter: { discoverable: { _eq: true }, user: { _and: [{ id: { _nin: exclude } }, { status: { _eq: 'active' } }, nameFilter].filter((f) => Object.keys(f).length) } },
      limit: 50,
    }),
  ])
  const ordered = [...new Set([...named.map((u) => u.id), ...discoverable.map((p) => p.user?.id).filter((id): id is string => !!id)])]
  const ok = await activeMembers(ordered)
  const ids = ordered.filter((id) => ok.has(id)).slice(0, 8)
  const people = await resolvePeople(ids)
  return ids.map((id) => people.get(id)).filter((p): p is SocialPerson => !!p)
}
