import { noStore, socialContext } from '../../../lib/core'
import { readLog } from '../../../lib/queue'

/** Moderators: this app's moderation log, newest first. `?before=<next>` pages. */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const q = getQuery(event)
  const before = typeof q.before === 'string' && !Number.isNaN(Date.parse(q.before)) ? q.before : undefined
  return readLog(ctx, { before })
})
