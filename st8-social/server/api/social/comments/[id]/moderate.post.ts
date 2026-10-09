import { readJson, socialContext } from '../../../../lib/core'
import { moderateComment } from '../../../../lib/comments'

/** Moderators: `{ action: 'hide' | 'unhide' | 'remove', reason? }`. Logged; the author is told, never by whom. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  return moderateComment(event, ctx, getRouterParam(event, 'id') ?? '', await readJson(event))
})
