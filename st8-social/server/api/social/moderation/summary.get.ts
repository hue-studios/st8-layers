import { noStore, socialContext } from '../../../lib/core'
import { moderationSummary } from '../../../lib/queue'

/** Whether the viewer moderates this app, and how many reported targets wait. Any active member may ask. */
export default defineEventHandler(async (event) => {
  noStore(event)
  return moderationSummary(await socialContext(event))
})
