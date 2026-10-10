import { socialContext } from '../../../lib/core'
import { unsuspendMember } from '../../../lib/suspensions'

/** Moderators: restore a suspended member here, `{ user, restoreContent? }`. */
export default defineEventHandler(async (event) => unsuspendMember(event, await socialContext(event)))
