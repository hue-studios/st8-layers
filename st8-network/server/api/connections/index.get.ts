import type { NetworkOverview } from '../../../shared/types/network'
import { noStore } from '../../lib/http'
import { readOverview } from '../../lib/overview'

// The member's network: connections (ranked for the Orbit), requests in and out, and the members they've blocked.
export default defineEventHandler(async (event): Promise<NetworkOverview> => {
  noStore(event)
  return readOverview(await st8SocialServer.socialContext(event))
})
