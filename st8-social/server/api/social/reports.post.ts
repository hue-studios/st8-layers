import { readJson, socialContext } from '../../lib/core'
import { createReport } from '../../lib/moderation'

/** Report a target: `{ collection, item, reason, details? }`. One report per member per target. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  setResponseStatus(event, 201)
  return createReport(event, ctx, await readJson(event))
})
