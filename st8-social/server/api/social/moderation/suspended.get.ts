import { noStore, socialContext } from '../../../lib/core'
import { readSuspended } from '../../../lib/queue'

/** Moderators: the members suspended in this app, with why, until when and by whom. */
export default defineEventHandler(async (event) => {
  noStore(event)
  return { items: await readSuspended(await socialContext(event)) }
})
