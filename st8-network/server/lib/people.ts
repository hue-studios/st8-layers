import { readUsers } from '@directus/sdk'
import type { NetworkPerson } from '../../shared/types/network'
import { chunks, rows, sys } from './edges'

// Members as the network shows them, read with the server account (members can't read other users) and only for ids
// on edges the caller is part of, or that the caller may already see. Inactive accounts are left out. Never an email.

interface UserRow { id: string, first_name: string | null, last_name: string | null, avatar: string | null, title: string | null, status: string }
interface ProfileRow { user: string, company: string | null, headline: string | null, industry: { id: number, name: string, color: string | null } | null }

const nameOf = (u: { first_name: string | null, last_name: string | null }) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Member'

/** People by id, active accounts only, with `member` = an active membership in this app. */
export async function networkPeople(ids: Iterable<string | null | undefined>): Promise<Map<string, NetworkPerson>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))]
  const out = new Map<string, NetworkPerson>()
  for (const part of chunks(wanted)) {
    const [users, profiles, members] = await Promise.all([
      sys().request(readUsers({ fields: ['id', 'first_name', 'last_name', 'avatar', 'title', 'status'], filter: { id: { _in: part }, status: { _eq: 'active' } }, limit: -1 })) as Promise<UserRow[]>,
      rows<ProfileRow>('profiles', {
        fields: ['user', 'company', 'headline', { industry: ['id', 'name', 'color'] }],
        filter: { user: { _in: part } },
        limit: -1,
      }),
      rows<{ user: string }>('memberships', {
        fields: ['user'],
        filter: { user: { _in: part }, app: { _eq: useSt8Network().app }, status: { _eq: 'active' } },
        limit: -1,
      }),
    ])
    const profileOf = new Map(profiles.map((p) => [String(p.user), p]))
    const member = new Set(members.map((m) => String(m.user)))
    for (const u of users) {
      const p = profileOf.get(u.id)
      out.set(u.id, {
        id: u.id,
        name: nameOf(u),
        first_name: u.first_name,
        last_name: u.last_name,
        avatar: typeof u.avatar === 'string' ? u.avatar : null,
        title: u.title ?? null,
        company: p?.company ?? null,
        headline: p?.headline ?? null,
        industry: p?.industry && typeof p.industry === 'object' ? { id: p.industry.id, name: p.industry.name, color: p.industry.color ?? null } : null,
        member: member.has(u.id),
      })
    }
  }
  return out
}
