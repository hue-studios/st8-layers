import { noStore } from '../../../lib/core'
import { status } from '../../../lib/push'

/** Whether push is set up here and on for this device: `{ endpoint? }` (POST, so an endpoint never lands in a URL or a log). */
export default defineEventHandler(async (event) => {
  noStore(event)
  return status(event)
})
