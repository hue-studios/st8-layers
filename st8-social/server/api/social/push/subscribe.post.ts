import { noStore } from '../../../lib/core'
import { subscribe } from '../../../lib/push'

/** Turn push on for this device: the browser's PushSubscription (toJSON()). Rate-limited; at most maxDevices per member. */
export default defineEventHandler(async (event) => {
  noStore(event)
  return subscribe(event)
})
