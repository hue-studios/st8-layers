import type { InviteRedeemResult } from '../../../shared/types/network'
import { noStore, readJson } from '../../lib/http'
import { redeemInvite } from '../../lib/invites'

// Redeem an invite link: { code }. Connects you with the inviter at once; once per person per link.
export default defineEventHandler(async (event): Promise<InviteRedeemResult> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  const { code } = await readJson<{ code: string }>(event)
  return redeemInvite(event, ctx, code)
})
