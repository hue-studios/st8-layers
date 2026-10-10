/**
 * Any same-origin /api request that comes back 401 while the member thinks they're signed in means the session ended
 * on the server (expired, or this app's membership was suspended: every /api request re-checks it at most every 30 s).
 * Wraps the global $fetch (which useFetch uses in the browser too) so every caller gets the same exit: sign-in, with
 * the suspended notice when that's why. The auth routes answer their own 401s (a wrong password is one).
 */
export default defineNuxtPlugin(() => {
  const { loggedIn } = useUserSession()
  const sessionEnded = useSessionEnded()
  const base = globalThis.$fetch
  globalThis.$fetch = base.create({
    onResponseError({ request, response }) {
      if (response.status !== 401 || !loggedIn.value) return
      const url = typeof request === 'string' ? request : request instanceof Request ? new URL(request.url).pathname : String(request)
      if (!url.startsWith('/api/') || url.startsWith('/api/auth/') || url.startsWith('/api/_')) return
      void sessionEnded((response._data as { data?: { reason?: string } } | undefined)?.data?.reason)
    },
  }) as typeof globalThis.$fetch
})
