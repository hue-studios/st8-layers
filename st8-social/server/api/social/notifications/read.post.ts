import { isSocialId, readJson, socialContext } from '../../../lib/core'
import { markRead } from '../../../lib/notifications'

/** Mark notifications read: `{ ids: [...] }` or `{ all: true }`. Returns the unread count. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  const body = await readJson<{ ids: unknown, all: unknown }>(event)
  if (body.all === true) return { unread: await markRead(ctx, 'all') }
  const ids = Array.isArray(body.ids) ? body.ids.filter(isSocialId).slice(0, 200) : []
  if (!ids.length) throw createError({ statusCode: 400, message: 'Pass `ids` or `all: true`.' })
  return { unread: await markRead(ctx, ids) }
})
