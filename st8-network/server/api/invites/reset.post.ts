import type { MyInvite } from '../../../shared/types/network'
import { noStore } from '../../lib/http'
import { resetInvite } from '../../lib/invites'

// End my invite link now and make a new one.
export default defineEventHandler(async (event): Promise<MyInvite> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  await networkRateLimit(event, ctx.me, 'inviteResets', 'You’ve reset your link a lot today.')
  return resetInvite(ctx.me)
})
