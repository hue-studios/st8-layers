import { timingSafeEqual } from 'node:crypto'
import { readItems } from '@directus/sdk'

/**
 * Reconcile directus_access with memberships (docs/go-live-plan.md §2). Called by the Directus Flow on memberships
 * create/update/delete (scripts/directus/memberships-flow.mjs), with the shared secret in `x-st8-sync-secret`.
 *
 * Body: the Flow's {{$trigger}} ({ event, key | keys, payload }), or { users: [id, …] } by hand. A delete can't be
 * read back to find its user, so deletes reconcile everyone who holds a managed access row.
 */
export default defineEventHandler(async (event) => {
  const secret = useRuntimeConfig().st8Auth.syncSecret || process.env.ST8_ACCESS_SYNC_SECRET || ''
  const given = getRequestHeader(event, 'x-st8-sync-secret') ?? ''
  if (!secret) throw createError({ statusCode: 404 })
  if (given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody<{ event?: string, key?: unknown, keys?: unknown, payload?: Record<string, unknown> | unknown[], users?: unknown }>(event)
  const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)
  const users = new Set<string>()
  const add = (v: unknown) => {
    const id = typeof v === 'string' ? v : (v as { id?: unknown })?.id
    if (isUuid(id)) users.add(id)
  }
  if (Array.isArray(body?.users)) body.users.forEach(add)
  if (body?.payload && !Array.isArray(body.payload)) add((body.payload as Record<string, unknown>).user)

  const isDelete = String(body?.event ?? '').endsWith('delete')
  if (isDelete) {
    for (const id of await usersWithManagedAccess()) users.add(id)
  } else {
    const keys = [...(Array.isArray(body?.keys) ? body.keys : []), body?.key].filter(isUuid)
    if (keys.length) {
      const rows = await getDirectus().request(readItems('memberships', { fields: ['user'], filter: { id: { _in: keys } }, limit: -1 }))
      rows.forEach((r) => add(r.user))
    }
  }

  const result = { users: users.size, added: 0, removed: 0, failed: 0 }
  for (const id of users) {
    const r = await syncAccess(id)
    result.added += r.added.length
    result.removed += r.removed.length
    result.failed += r.failed.length
  }
  return { ok: true, ...result }
})
