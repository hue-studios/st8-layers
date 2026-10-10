import { onMembershipChanged } from '../lib/suspensions'

// Membership changes this app didn't make itself (layers/st8-auth): a suspension that ran out, or an admin's edit in
// the Studio, are logged here (and a run-out suspension brings back what it hid).
export default defineNitroPlugin(() => {
  onMembershipChange(onMembershipChanged)
})
