import { readUsers } from '@directus/sdk'

export interface UserLookup {
  id: string
  email: string
  first_name: string | null
  status: string
  role: string | null
}

/**
 * Find a user by email, case-insensitively. Directus has no case-insensitive equals, and a few legacy accounts store
 * mixed-case emails, so this narrows with _icontains and matches exactly on the lowercased value.
 */
export async function findUserByEmail(email: string): Promise<UserLookup | null> {
  const target = email.toLowerCase()
  const rows = await getDirectus().request(
    readUsers({ fields: ['id', 'email', 'first_name', 'status', 'role'], filter: { email: { _icontains: target } }, limit: 25 }),
  )
  const user = rows.find((u) => (u.email ?? '').toLowerCase() === target)
  if (!user) return null
  return {
    id: user.id,
    email: target,
    first_name: user.first_name ?? null,
    status: String(user.status ?? ''),
    role: typeof user.role === 'string' ? user.role : null,
  }
}
