import { noStore } from '../../../lib/core'
import { unsubscribe } from '../../../lib/push'

/** Turn push off for this device: `{ endpoint }`, the member's own rows only. */
export default defineEventHandler(async (event) => {
  noStore(event)
  return unsubscribe(event)
})
