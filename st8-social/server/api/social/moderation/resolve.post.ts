import { socialContext } from '../../../lib/core'
import { resolveQueueItem } from '../../../lib/review'

/**
 * Moderators: act on a reported target, `{ collection, item, action, reason? }` with action dismiss | hide | unhide |
 * remove | lock | unlock | clear | refer. Returns the target as the queue now shows it.
 */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  return { item: await resolveQueueItem(event, ctx) }
})
