import { createItem, customEndpoint, readItems, readUser, updateItems } from '@directus/sdk'
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
// syncAccess only touches the rows this app manages: user-level directus_access rows whose policy appears in
// app_role_policies **for this app** (st8Auth.app). Role-level rows, rows for another app's policies, and rows for any
// policy that isn't mapped (Studio, admin, anything attached by hand for another reason) are never read for removal,
// so it can't take away access it didn't grant. Each app's server account may only grant its own app's policies, so
// every app reconciles its own (the memberships Flow calls each app's /api/auth/sync-access). Which policies are
// wanted is still worked out from all of the user's active memberships: a policy two apps map (ST8 Social) stays while
// either membership is active.

interface AccessRow {
  id: string
  user: string | null
  policy: string
}

const accessEndpoint = (params: Record<string, unknown>) =>
  customEndpoint<AccessRow[]>({ path: '/access', method: 'GET', params })

/** All app_role_policies rows: (app, role) → policy, every app's. */
async function readPolicyMap() {
  const rows = await getDirectus().request(
    readItems('app_role_policies', { fields: ['app', 'role', 'policy'], limit: -1 }),
  )
  return rows.filter((r): r is typeof r & { app: St8App, role: string, policy: string } => !!r.app && !!r.role && typeof r.policy === 'string')
}

/** The user's membership in `app`, or null. A suspension that has run out still reads as suspended here. */
export async function readMembership(userId: string, app: St8App): Promise<SessionMembership | null> {
  const [row] = await getDirectus().request(
    readItems('memberships', {
      fields: ['app', 'role', 'status', 'suspended_until'],
      filter: { user: { _eq: userId }, app: { _eq: app } },
      limit: 1,
    }),
  )
  if (!row?.app || !row.role || !row.status) return null
  return { app: row.app, role: row.role, status: row.status, until: row.status === 'suspended' ? (row.suspended_until ?? null) : null }
}

// ── Suspension (memberships.status = suspended, per app) ──────────────────────────────────────────────────────────
//
// Suspending sets this app's membership to `suspended` (with an optional end and an internal reason) and reconciles
// policies at once, so the member's Directus token loses this app's policies straight away. Their sessions here end
// within getSessionMembership's 30 s re-check; their role, account status, other apps' memberships and the Studio are
// never touched. A suspension with an end is lifted lazily, the first time the membership is read after it
// (currentMembership): at sign-in, or by a session check.

export interface MembershipChange {
  user: string
  app: St8App
  status: 'active' | 'suspended'
  until: string | null
  reason: string | null
  /** Who changed it: a user id, or null for the system (a suspension that ran out). */
  by: string | null
  /** `app`: this app's own moderation; `expiry`: a timed suspension ended; `studio`: someone edited the row in Directus. */
  source: 'app' | 'expiry' | 'studio'
}

type MembershipListener = (change: MembershipChange) => Promise<void> | void
const listeners: MembershipListener[] = []

/**
 * Be told when a membership is suspended or restored (other layers: st8-social logs it and restores content). Called
 * after the change and its policy sync; a listener's failure is logged, never thrown.
 */
export function onMembershipChange(listener: MembershipListener) {
  listeners.push(listener)
}

export async function emitMembershipChange(change: MembershipChange) {
  for (const listener of listeners) {
    try {
      await listener(change)
    } catch (err) {
      console.error('[st8-auth] membership listener failed:', directusError(err).message ?? err)
    }
  }
}

/**
 * Suspend `userId` in `app` (until a date, or indefinitely). Returns false if there's no active membership to suspend.
 * Listeners hear about it with `source: 'app'`.
 */
export async function suspendMembership(userId: string, app: St8App, opts: { until: string | null, reason: string, by: string }): Promise<boolean> {
  const updated = await getDirectus().request(updateItems('memberships', {
    filter: { user: { _eq: userId }, app: { _eq: app }, status: { _eq: 'active' } },
    limit: 1,
  }, { status: 'suspended', suspended_until: opts.until, suspended_reason: opts.reason }, { fields: ['id'] }))
  if (!updated.length) return false
  forgetMembership(userId) // this instance notices at their next request; others within 30 s
  await syncAccess(userId)
  await emitMembershipChange({ user: userId, app, status: 'suspended', until: opts.until, reason: opts.reason, by: opts.by, source: 'app' })
  return true
}

/**
 * Restore a suspended membership. `by` null = the suspension ran out (`source: 'expiry'`). Returns false if it wasn't
 * suspended (or, for an expiry, if it has no end yet to pass): parallel requests restore it once.
 */
export async function restoreMembership(userId: string, app: St8App, opts: { by: string | null }): Promise<boolean> {
  const filter: Record<string, unknown> = { user: { _eq: userId }, app: { _eq: app }, status: { _eq: 'suspended' } }
  if (!opts.by) filter.suspended_until = { _nnull: true, _lte: new Date().toISOString() }
  const updated = await getDirectus().request(updateItems('memberships', { filter, limit: 1 } as never, {
    status: 'active',
    suspended_until: null,
    suspended_reason: null,
  }, { fields: ['id'] }))
  if (!updated.length) return false
  forgetMembership(userId)
  await syncAccess(userId)
  await emitMembershipChange({ user: userId, app, status: 'active', until: null, reason: opts.by ? null : 'Suspension ended', by: opts.by, source: opts.by ? 'app' : 'expiry' })
  return true
}

/** readMembership, lifting a suspension whose end has passed first. */
export async function currentMembership(userId: string, app: St8App): Promise<SessionMembership | null> {
  const membership = await readMembership(userId, app)
  if (membership?.status !== 'suspended' || !membership.until || Date.parse(membership.until) > Date.now()) return membership
  await restoreMembership(userId, app, { by: null })
  return readMembership(userId, app)
}

/** The policies this app manages: the ones its own app_role_policies rows name. */
const managedBy = (map: Awaited<ReturnType<typeof readPolicyMap>>, app: St8App) =>
  new Set(map.filter((m) => m.app === app).map((m) => m.policy))

/**
 * Reconcile the user's directus_access rows for this app's policies with their active memberships: add this app's
 * policies that any active membership maps to, remove this app's policies none of them map to, and drop duplicate
 * rows. Other apps' policies are theirs to reconcile. Idempotent; safe to call any time.
 */
export async function syncAccess(userId: string): Promise<{ added: string[], removed: string[], failed: string[] }> {
  const directus = getDirectus()
  const { app } = useSt8Auth()
  const [map, memberships, rows] = await Promise.all([
    readPolicyMap(),
    directus.request(readItems('memberships', { fields: ['app', 'role', 'status'], filter: { user: { _eq: userId } }, limit: -1 })),
    directus.request(accessEndpoint({ filter: { user: { _eq: userId } }, fields: ['id', 'user', 'policy'], limit: -1 })),
  ])

  const managed = managedBy(map, app)
  // Every app's mappings: a policy this app shares with another (ST8 Social) is wanted while either membership is active.
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

  // Two syncs can run at once (the app's on sign-in and the memberships Flow's, fired by the same new membership). A row
  // the other one deleted first answers 403 (Directus's answer for a missing row): that's done, not a failure.
  const rowGone = async (id: string) => !(await directus.request(accessEndpoint({ filter: { id: { _eq: id } }, fields: ['id'], limit: 1 })).catch(() => [{}])).length
  const remove = async (row: AccessRow) => {
    try {
      await directus.request(customEndpoint({ path: `/access/${row.id}`, method: 'DELETE' }))
      return true
    } catch (err) {
      if (await rowGone(row.id)) return false
      return attempt('remove', row.policy, () => Promise.reject(err))
    }
  }

  const seen = new Set<string>()
  for (const row of rows) {
    if (!managed.has(row.policy)) continue // not ours: leave it alone
    if (wanted.has(row.policy) && !seen.has(row.policy)) {
      seen.add(row.policy)
      continue
    }
    if (await remove(row)) removed.push(row.policy)
  }
  for (const policy of wanted) {
    if (seen.has(policy) || !managed.has(policy)) continue // another app's policy: its server grants it
    const body = JSON.stringify({ user: userId, policy })
    const ok = await attempt('add', policy, () => directus.request(customEndpoint({ path: '/access', method: 'POST', body })))
    if (ok) added.push(policy)
  }
  // Both syncs may have added the same policy. Re-read each added one and keep the row with the lowest id: whichever
  // sync re-reads second sees both rows and keeps the same one the other would, so overlapping syncs converge on one.
  for (const policy of added) {
    const mine = await directus.request(accessEndpoint({ filter: { user: { _eq: userId }, policy: { _eq: policy } }, fields: ['id', 'user', 'policy'], limit: -1 }))
      .catch(() => [] as AccessRow[])
    const extra = [...mine].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(1)
    for (const row of extra) if (await remove(row)) removed.push(row.policy)
  }

  if (added.length || removed.length) console.info(`[st8-auth] syncAccess ${userId}: +${added.length} −${removed.length}`)
  return { added, removed, failed }
}

/**
 * Make the user a member of `app` (open signup) and grant that app's policies, additively. Creates an active `member`
 * membership if there is none; an existing row is left as it is, so a suspended membership stays suspended (callers
 * check status before calling). Then reconciles policies with syncAccess. Never writes the user's role. `via` (a checked
 * join source, server/utils/join-via.ts) is recorded only on a membership created here.
 */
export async function ensureAppAccess(userId: string, app: St8App, opts: { via?: string | null } = {}): Promise<{ membership: SessionMembership, joined: boolean }> {
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
          // Where they joined from (another app's teaser), written once, here. parseJoinVia has checked it.
          ...(opts.via ? { joined_via: opts.via } : {}),
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
 * Users the memberships Flow may need to reconcile after a delete: everyone holding a user-level access row for one of
 * this app's policies. (A deleted membership can't be read back to find its user.)
 */
export async function usersWithManagedAccess(): Promise<string[]> {
  const policies = [...managedBy(await readPolicyMap(), useSt8Auth().app)]
  if (!policies.length) return []
  const rows = await getDirectus().request(
    accessEndpoint({ filter: { user: { _nnull: true }, policy: { _in: policies } }, fields: ['user'], limit: -1 }),
  )
  return [...new Set(rows.map((r) => r.user).filter((u): u is string => !!u))]
}
