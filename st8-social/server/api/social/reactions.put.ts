import { readJson, socialContext } from '../../lib/core'
import { setReaction } from '../../lib/reactions'

/** Set, switch or clear your reaction: `{ collection, item, reaction }`, with `reaction: null` to clear. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  return setReaction(event, ctx, await readJson(event))
})
