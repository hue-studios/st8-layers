import { createItem, readItems, readUser } from '@directus/sdk'
import type { User } from '#auth-utils'
import type { SessionProfile } from '../../shared/types/auth'

// Identity lives on directus_users (names, email, avatar, title); everything else on the global `profiles` row, one
// per user (docs/go-live-plan.md §2). Both are read with the server token: the member's own token may not see every
// field, and these reads are only ever for the signed-in user.

const USER_FIELDS = ['id', 'email', 'first_name', 'last_name', 'avatar', 'title'] as const

export interface ProfileDetails {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  title: string | null
  avatar: string | null
  profile: {
    id: string
    headline: string | null
    company: string | null
    industry: { id: number, name: string, color: string | null } | null
    bio: string | null
    skills: string[]
    website: string | null
    linkedin: string | null
    discoverable: boolean
  } | null
}

async function readProfileRow(userId: string) {
  const [row] = await getDirectus().request(
    readItems('profiles', {
      fields: ['id', 'headline', 'company', 'bio', 'skills', 'website', 'linkedin', 'discoverable', { industry: ['id', 'name', 'color'] }],
      filter: { user: { _eq: userId } },
      limit: 1,
    }),
  )
  return row ?? null
}

/** The user's identity and global profile, with the profile's industry name and colour. */
export async function fetchProfile(userId: string): Promise<ProfileDetails> {
  const [user, row] = await Promise.all([
    getDirectus().request(readUser(userId, { fields: [...USER_FIELDS] })),
    readProfileRow(userId),
  ])
  const industry = row?.industry && typeof row.industry === 'object' ? row.industry : null
  return {
    id: user.id,
    email: (user.email ?? '').toLowerCase(),
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    title: user.title ?? null,
    avatar: typeof user.avatar === 'string' ? user.avatar : null,
    profile: row
      ? {
          id: row.id,
          headline: row.headline ?? null,
          company: row.company ?? null,
          industry: industry ? { id: industry.id, name: industry.name ?? '', color: industry.color ?? null } : null,
          bio: row.bio ?? null,
          skills: Array.isArray(row.skills) ? row.skills : [],
          website: row.website ?? null,
          linkedin: row.linkedin ?? null,
          discoverable: !!row.discoverable,
        }
      : null,
  }
}

/** The browser-visible session user: identity plus a profile summary. No tokens. */
export async function fetchSessionUser(userId: string): Promise<User> {
  const details = await fetchProfile(userId)
  const profile: SessionProfile | null = details.profile
    ? { id: details.profile.id, headline: details.profile.headline, industry: details.profile.industry }
    : null
  return {
    id: details.id,
    email: details.email,
    first_name: details.first_name,
    last_name: details.last_name,
    avatar: details.avatar,
    profile,
  }
}

/** Create the user's empty `profiles` row if it's missing (new signups, and partners joining an app). Idempotent. */
export async function ensureProfile(userId: string): Promise<{ created: boolean }> {
  const [existing] = await getDirectus().request(
    readItems('profiles', { fields: ['id'], filter: { user: { _eq: userId } }, limit: 1 }),
  )
  if (existing) return { created: false }
  try {
    await getDirectus().request(createItem('profiles', { user: userId, discoverable: false }))
    return { created: true }
  } catch (err) {
    // A parallel request created it first (profiles.user is unique).
    if (directusError(err).code === 'RECORD_NOT_UNIQUE') return { created: false }
    throw err
  }
}
