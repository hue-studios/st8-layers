import { noStore, socialContext } from '../../lib/core'
import { searchMentions } from '../../lib/people'
import { findThread, requireTarget } from '../../lib/threads'

/**
 * Mention autocomplete: `?q=jen&collection=events&item=12`. Lists people already in the thread, accepted connections
 * and discoverable members (see searchMentions), never the viewer or anyone blocked.
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const q = getQuery(event)
  let threadId: string | null = null
  if (q.collection) {
    const { collection, item } = await requireTarget(event, ctx, { collection: q.collection, item: q.item }, 'comments')
    threadId = (await findThread(collection, item))?.id ?? null
  }
  return searchMentions(ctx, typeof q.q === 'string' ? q.q : '', threadId)
})
