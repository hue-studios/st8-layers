import { noStore, socialContext } from '../../lib/core'
import { summarize } from '../../lib/threads'
import { parseTargetKey } from '../../../shared/utils/social'

/**
 * Thread summaries (counts, the viewer's reaction, a couple of reactors, locked) for many targets at once:
 * `?t=events:12&t=events:14` (up to 60). A fixed number of queries however many targets; targets the viewer can't
 * see are left out.
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const raw = getQuery(event).t
  const keys = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String).slice(0, 60)
  const refs = keys.map(parseTargetKey).filter((r): r is { collection: string, item: string } => !!r && r.item.length <= 64)
  return { viewer: { id: ctx.me, canModerate: await ctx.isModerator() }, threads: await summarize(event, ctx, refs) }
})
