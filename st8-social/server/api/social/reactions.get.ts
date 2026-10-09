import { noStore, socialContext } from '../../lib/core'
import { listReactors } from '../../lib/reactions'

/** Who reacted to a target, and with what: `?collection=…&item=…`. */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const q = getQuery(event)
  return listReactors(event, ctx, { collection: q.collection, item: q.item })
})
