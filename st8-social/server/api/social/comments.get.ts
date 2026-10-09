import { noStore, socialContext } from '../../lib/core'
import { readThreadDelta, readThreadPage } from '../../lib/comments'

/**
 * A target's comments. `?collection=events&item=12` → the newest page of top-level comments with their newest
 * replies (`&before=<next>` for older pages). With `&since=<cursor>&roots=<id,id,…>` → only what changed in the
 * loaded part of the thread, plus the ids still visible (the realtime refetch after a version bump).
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const q = getQuery(event)
  const ref = { collection: q.collection, item: q.item }
  const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined)
  const since = iso(q.since)
  if (since) {
    const roots = typeof q.roots === 'string' ? q.roots.split(',').filter(Boolean) : []
    return readThreadDelta(event, ctx, ref, { since, roots })
  }
  return readThreadPage(event, ctx, ref, { before: iso(q.before), limit: Number(q.limit) || 10 })
})
