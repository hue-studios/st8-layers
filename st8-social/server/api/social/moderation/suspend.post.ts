import { socialContext } from '../../../lib/core'
import { suspendMember } from '../../../lib/suspensions'

/** Moderators: suspend a member here, `{ user, until: ISO | null, reason, hideContent?, from? }`. */
export default defineEventHandler(async (event) => suspendMember(event, await socialContext(event)))
