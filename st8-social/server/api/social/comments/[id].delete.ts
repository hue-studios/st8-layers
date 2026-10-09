import { socialContext } from '../../../lib/core'
import { deleteComment } from '../../../lib/comments'

/** Delete your comment: gone if nobody replied, a "[deleted]" tombstone if they did. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  return deleteComment(event, ctx, getRouterParam(event, 'id') ?? '')
})
