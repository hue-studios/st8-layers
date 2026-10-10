import { noStore, socialContext } from '../../lib/core'
import { teasersFor } from '../../lib/teasers'
import { parseTargetKey } from '../../../shared/utils/social'

/**
 * Cross-app teasers: other apps' activity on targets the viewer can see, `?t=events:12&t=…` (up to 30). Counts and
 * reaction keys only, from the apps in `public.st8Social.teasers`, at or above `st8Social.teaserThreshold` people
 * after leaving out anyone blocked with the viewer. Targets with nothing to show are absent.
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await socialContext(event)
  const raw = getQuery(event).t
  const keys = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String).slice(0, 30)
  const refs = keys.map(parseTargetKey).filter((r): r is { collection: string, item: string } => !!r && r.item.length <= 64)
  // `app` is this app, for the join links' `via` (`<app>:<collection>:<item>`).
  return { app: useSt8Social().app, teasers: await teasersFor(event, ctx, refs) }
})
