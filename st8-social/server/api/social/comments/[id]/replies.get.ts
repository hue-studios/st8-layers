import { noStore, socialContext } from '../../../../lib/core'
import { readGroup } from '../../../../lib/comments'

/** Every visible reply in a group ("View N more replies"): under a top-level comment, or under a depth-1 reply. */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  return readGroup(event, ctx, getRouterParam(event, 'id') ?? '')
})
