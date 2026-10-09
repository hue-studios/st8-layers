import { readJson, socialContext } from '../../lib/core'
import { getOrCreateThread, requireTarget, summarizeOne } from '../../lib/threads'

/** Get or create the thread for a target: `{ collection, item }`. Returns its summary. */
export default defineEventHandler(async (event) => {
  const ctx = await socialContext(event)
  const body = await readJson<{ collection: string, item: string }>(event)
  const def = socialTarget(body.collection)
  const { collection, item } = await requireTarget(event, ctx, body, def?.comments ? 'comments' : 'reactions')
  await getOrCreateThread(collection, item)
  return summarizeOne(event, ctx, collection, item)
})
