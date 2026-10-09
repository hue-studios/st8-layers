import { createItem, customEndpoint, readItems, readUser } from '@directus/sdk'
import type { St8App } from './st8-auth'
import type { SessionMembership } from '../../shared/types/auth'

// Per-app access (docs/go-live-plan.md §2, "Different access levels per app").
//
//   memberships (user, app, role, status)  ──app_role_policies──▶  user-level directus_access rows
//
// The Directus role is never written here. A user who already has one (all 79 partners: `User`, with Studio access)
// keeps it; app access is added on top as policies. New signups get `ST8 Member` from the server policy's create
// preset, not from this file.
//
// syncAccess only touches the rows it manages: user-level directus_access rows whose policy appears somewhere in
// app_role_policies. Role-level rows, and user-level rows for any policy that isn't mapped (Studio, admin, anything
// attached by hand for another reason), are never read for removal, so it can't take away access it didn't grant.

interface AccessRow {
  id: string
  user: string | null
  policy: string
}

const accessEndpoint = (params: Record<string, unknown>) =>
  customEndpoint<AccessRow[]>({ path: '/access', method: 'GET', params })

/** All app_role_policies rows: (app, role) → policy. */
async function readPolicyMap() {
  const rows = await getDirectus().request(
    readItems('app_role_policies', { fields: ['app', 'role', 'policy'], limit: -1 }),
  )
  return rows.filter((r): r is typeof r & { app: St8App, role: string, policy: string } => !!r.app && !!r.role && typeof r.policy === 'string')
}

/** The user's membership in `app`, or null. */
export async function readMembership(userId: string, app: St8App): Promise<SessionMembership | null> {
  const [row] = await getDirectus().request(
    readItems('memberships', {
      fields: ['app', 'role', 'status'],
      filter: { user: { _eq: userId }, app: { _eq: app } },
      limit: 1,
    }),
  )
  if (!row?.app || !row.role || !row.status) return null
  return { app: row.app, role: row.role, status: row.status }
}

/**
 * Reconcile the user's managed directus_access rows with their active memberships: add the policies the memberships
 * map to, remove managed policies none of them map to, and drop duplicate rows. Idempotent; safe to call any time.
 */
export async function syncAccess(userId: string): Promise<{ added: string[], removed: string[], failed: string[] }> {
  const directus = getDirectus()
  const [map, memberships, rows] = await Promise.all([
    readPolicyMap(),
    directus.request(readItems('memberships', { fields: ['app', 'role', 'status'], filter: { user: { _eq: userId } }, limit: -1 })),
    directus.request(accessEndpoint({ filter: { user: { _eq: userId } }, fields: ['id', 'user', 'policy'], limit: -1 })),
  ])

  const managed = new Set(map.map((m) => m.policy))
  const wanted = new Set(
    map
      .filter((m) => memberships.some((ms) => ms.status === 'active' && ms.app === m.app && ms.role === m.role))
      .map((m) => m.policy),
  )

  const added: string[] = []
  const removed: string[] = []
  // A row the server policy may not touch is logged and skipped, so one bad mapping can't block sign-in.
  const failed: string[] = []
  const attempt = async (what: string, policy: string, run: () => Promise<unknown>) => {
    try {
      await run()
      return true
    } catch (err) {
      const { status, message } = directusError(err)
      console.error(`[st8-auth] syncAccess ${userId}: could not ${what} policy ${policy} (${status}: ${message})`)
      failed.push(policy)
      return false
    }
  }

  const seen = new Set<string>()
  for (const row of rows) {
    if (!managed.has(row.policy)) continue // not ours: leave it alone
    if (wanted.has(row.policy) && !seen.has(row.policy)) {
      seen.add(row.policy)
      continue
    }
    const ok = await attempt('remove', row.policy, () => directus.request(customEndpoint({ path: `/access/${row.id}`, method: 'DELETE' })))
    if (ok) removed.push(row.policy)
  }
  for (const policy of wanted) {
    if (seen.has(policy)) continue
    const body = JSON.stringify({ user: userId, policy })
    const ok = await attempt('add', policy, () => directus.request(customEndpoint({ path: '/access', method: 'POST', body })))
    if (ok) added.push(policy)
  }

  if (added.length || removed.length) console.info(`[st8-auth] syncAccess ${userId}: +${added.length} −${removed.length}`)
  return { added, removed, failed }
}

/**
 * Make the user a member of `app` (open signup) and grant that app's policies, additively. Creates an active `member`
 * membership if there is none; an existing row is left as it is, so a suspended membership stays suspended (callers
 * check status before calling). Then reconciles policies with syncAccess. Never writes the user's role.
 */
export async function ensureAppAccess(userId: string, app: St8App): Promise<{ membership: SessionMembership, joined: boolean }> {
  let membership = await readMembership(userId, app)
  let joined = false

  if (!membership) {
    const user = await getDirectus().request(readUser(userId, { fields: ['id', 'role'] }))
    if (!user.role) {
      // Role-less accounts (service users, legacy imports) can't be given ST8 Member here: the service account's policy
      // may not write `role`. They still get the app's policies below.
      console.warn(`[st8-auth] ${userId} has no role; granting ${app} policies only`)
    }
    try {
      await getDirectus().request(
        createItem('memberships', {
          unique_key: `${userId}:${app}`,
          user: userId,
          app,
          role: 'member',
          status: 'active',
          joined_at: new Date().toISOString(),
        }),
      )
      joined = true
    } catch (err) {
      // A parallel sign-in created it first (unique_key); use theirs.
      if (directusError(err).code !== 'RECORD_NOT_UNIQUE') throw err
    }
    membership = (await readMembership(userId, app)) ?? { app, role: 'member', status: 'active' }
  }

  await syncAccess(userId)
  return { membership, joined }
}

/**
 * Users the memberships Flow may need to reconcile after a delete: everyone holding a managed user-level access row.
 * (A deleted membership can't be read back to find its user.)
 */
export async function usersWithManagedAccess(): Promise<string[]> {
  const map = await readPolicyMap()
  const policies = [...new Set(map.map((m) => m.policy))]
  if (!policies.length) return []
  const rows = await getDirectus().request(
    accessEndpoint({ filter: { user: { _nnull: true }, policy: { _in: policies } }, fields: ['user'], limit: -1 }),
  )
  return [...new Set(rows.map((r) => r.user).filter((u): u is string => !!u))]
}
