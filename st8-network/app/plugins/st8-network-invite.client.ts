import { toast } from 'vue-sonner'

// Redeem a remembered invite (useNetworkInvite) once the visitor is signed in, wherever they land first. The invite
// landing page handles its own code itself.
export default defineNuxtPlugin(() => {
  const { loggedIn } = useUserSession()
  const invite = useNetworkInvite()
  const route = useRoute()
  const invitePath = (useRuntimeConfig().public.st8Network as { invitePath?: string } | undefined)?.invitePath || '/i/'
  let running = false

  async function run() {
    const code = invite.pending.value
    if (!loggedIn.value || !code || running || route.path.startsWith(invitePath)) return
    running = true
    try {
      const result = await invite.redeem(code)
      if (!result.already) toast.success(`You’re connected with ${result.inviter.name}.`)
      void useConnections().refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      running = false
    }
  }

  watch([loggedIn, () => route.path], run, { immediate: true })
})
