/**
 * Re-validate the session when the app comes back to the foreground (a backgrounded tab or installed PWA can sit for
 * hours), and every couple of minutes while it's in view. The heartbeat refreshes the Directus token and slides the
 * session window if due, so the member doesn't meet a stale or signed-out state on their first tap; it also re-reads
 * the membership, so an open page notices a suspension. 401 = the session is gone (expired, or the membership was
 * suspended: `/login?suspended=1`). Any other /api request that gets a 401 does the same (session-guard.client.ts).
 */
export default defineNuxtPlugin(() => {
  const { loggedIn, fetch: fetchSession } = useUserSession()
  const sessionEnded = useSessionEnded()

  let last = 0
  const THROTTLE_MS = 30_000
  const HEARTBEAT_MS = 2 * 60_000

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
      if (status === 401) await sessionEnded((err as { data?: { data?: { reason?: string } } })?.data?.data?.reason)
      // Transient (503, offline): keep the session and try again on the next resume.
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidate()
  })
  window.addEventListener('focus', revalidate)
  // While the page is in view: an idle open page still notices a suspension within a few minutes.
  setInterval(() => document.visibilityState === 'visible' && revalidate(), HEARTBEAT_MS)
})
