import { noStore, socialContext } from '../../../lib/core'
import { moderateTarget } from '../../../lib/moderation'

/**
 * Moderators: `{ collection, item, action: 'hide' | 'unhide' | 'remove', reason? }` on a host item registered with a
 * `moderate` hook (Insider: posts). Logged; pending reports closed; the owner is told, never by whom.
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  return moderateTarget(event, await socialContext(event))
})
