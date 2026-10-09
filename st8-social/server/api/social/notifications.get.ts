import { noStore, socialContext } from '../../lib/core'
import { listNotifications } from '../../lib/notifications'

/** Your notifications in this app, newest first, with the unread count. `?before=<next>` pages; `?limit=` up to 50. */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const q = getQuery(event)
  const before = typeof q.before === 'string' && !Number.isNaN(Date.parse(q.before)) ? q.before : undefined
  return listNotifications(ctx, { before, limit: Math.min(Math.max(Number(q.limit) || 20, 1), 50) })
})
