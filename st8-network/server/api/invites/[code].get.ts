import type { InvitePreview } from '../../../shared/types/network'
import { noStore } from '../../lib/http'
import { previewInvite } from '../../lib/invites'

// Public: what an invite landing shows (the inviter's name, photo and work). Signed in, also how you stand with them.
export default defineEventHandler(async (event): Promise<InvitePreview> => {
  noStore(event)
  await networkRateLimit(event, getRequestIP(event, { xForwardedFor: true }) ?? 'unknown', 'invitePreview', 'Too many requests.')
  const session = await getUserSession(event)
  return previewInvite(getRouterParam(event, 'code'), session.user?.id ?? null)
})
