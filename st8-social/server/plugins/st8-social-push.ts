import { removeSessionSubscription, removeUserSubscriptions } from '../lib/push'

// Push removal paths (README, "Push"): signing out drops this device's subscription (st8-auth's session-end hook, so
// it holds even if the page's script never ran); a suspension, or any status but active, drops every device of the
// member in this app. A deleted account's rows go with it (CASCADE); a deleted membership is caught at the next send.
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('st8-auth:session-end', ({ session }) => removeSessionSubscription(session))
  onMembershipChange(async (change) => {
    if (change.app === useSt8Social().app && change.status !== 'active') await removeUserSubscriptions(change.user)
  })
})
