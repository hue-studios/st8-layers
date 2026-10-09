import { readJson, socialContext } from '../../lib/core'
import { createComment } from '../../lib/comments'

/** Comment on a target, or reply: `{ collection, item, body, parent? }`. Mentions are `<@user-id>` tokens in the body. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  setResponseStatus(event, 201)
  return createComment(event, ctx, await readJson(event))
})
