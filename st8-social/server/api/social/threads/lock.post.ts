import { readJson, socialContext } from '../../../lib/core'
import { lockThread } from '../../../lib/comments'

/** Moderators: close or reopen a thread to new comments. `{ collection, item, locked }`. Logged. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  return lockThread(event, ctx, await readJson(event))
})
