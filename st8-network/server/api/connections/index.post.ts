import type { ConnectionResult } from '../../../shared/types/network'
import { requestConnection } from '../../lib/actions'
import { noStore, readJson } from '../../lib/http'

// Ask to connect: { user }. Asking someone who already asked you connects you both.
export default defineEventHandler(async (event): Promise<ConnectionResult> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  const body = await readJson<{ user: string }>(event)
  return requestConnection(event, ctx, body.user)
})
