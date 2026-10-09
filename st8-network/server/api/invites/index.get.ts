import type { MyInvite } from '../../../shared/types/network'
import { noStore } from '../../lib/http'
import { myInvite } from '../../lib/invites'

// My personal invite link, made on first use.
export default defineEventHandler(async (event): Promise<MyInvite> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  return myInvite(ctx.me)
})
