import type { ConnectionResult } from '../../../shared/types/network'
import { setBlocked } from '../../lib/actions'
import { noStore, readJson } from '../../lib/http'

// Block or unblock a member: { user, blocked }.
export default defineEventHandler(async (event): Promise<ConnectionResult> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  const body = await readJson<{ user: string, blocked: boolean }>(event)
  if (typeof body.blocked !== 'boolean') throw createError({ statusCode: 400, message: 'Say whether to block.' })
  return setBlocked(event, ctx, body.user, body.blocked)
})
