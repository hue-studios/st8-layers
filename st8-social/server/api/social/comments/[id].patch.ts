import { readJson, socialContext } from '../../../lib/core'
import { editComment } from '../../../lib/comments'

/** Edit your comment's body: within the edit window, or any time before someone replies. `{ body }`. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  return editComment(event, ctx, getRouterParam(event, 'id') ?? '', await readJson(event))
})
