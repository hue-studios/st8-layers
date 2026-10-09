/**
 * Re-validate the session when the app comes back to the foreground (a backgrounded tab or installed PWA can sit for
 * hours). The heartbeat refreshes the Directus token and slides the session window if due, so the member doesn't meet
 * a stale or signed-out state on their first tap. 401 = the session is gone (expired, or the membership was suspended).
 */
export default defineNuxtPlugin(() => {
  const { loggedIn, fetch: fetchSession } = useUserSession()
  const router = useRouter()

  let last = 0
  const THROTTLE_MS = 30_000

  async function revalidate() {
    if (!loggedIn.value) return
    const now = Date.now()
    if (now - last < THROTTLE_MS) return
    last = now
    try {
      await $fetch('/api/auth/heartbeat')
      await fetchSession() // pick up a refreshed name/avatar/profile from the re-sealed cookie
    } catch (err) {
      const status = (err as { statusCode?: number, status?: number })?.statusCode ?? (err as { status?: number })?.status
      if (status === 401) {
        await fetchSession()
        const here = router.currentRoute.value.fullPath
        await router.replace({ path: '/login', query: here === '/' ? {} : { redirect: here } })
      }
      // Transient (503, offline): keep the session and try again on the next resume.
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidate()
  })
  window.addEventListener('focus', revalidate)
})
