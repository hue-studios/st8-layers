import type { ConnectionAction, ConnectionResult } from '../../../shared/types/network'
import { respond } from '../../lib/actions'
import { noStore, readJson } from '../../lib/http'

const ACTIONS: ConnectionAction[] = ['accept', 'decline', 'cancel', 'remove']

// Answer, withdraw or end a connection with a member: { action: accept | decline | cancel | remove }.
export default defineEventHandler(async (event): Promise<ConnectionResult> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  const { action } = await readJson<{ action: ConnectionAction }>(event)
  if (!action || !ACTIONS.includes(action)) throw createError({ statusCode: 400, message: 'Unknown action.' })
  return respond(event, ctx, getRouterParam(event, 'user'), action)
})
