import { noStore, socialContext } from '../../../lib/core'
import { readQueue } from '../../../lib/queue'

/**
 * Moderators: reported targets with their reports. `?tab=pending` (default) or `reviewed` (`&before=<next>` pages);
 * `?target=<collection>:<item>` for one target, whatever its reports' state.
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const q = getQuery(event)
  const tab = q.tab === 'reviewed' ? 'reviewed' : 'pending'
  const before = typeof q.before === 'string' && !Number.isNaN(Date.parse(q.before)) ? q.before : undefined
  const target = typeof q.target === 'string' && q.target ? q.target : undefined
  return readQueue(ctx, { tab, target, before })
})
