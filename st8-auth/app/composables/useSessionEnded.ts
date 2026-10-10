// What the app does when the server says the session is over (a 401 from the heartbeat or any /api request): re-read
// the session and go to sign-in, back to this page afterwards. A suspension (`data.reason = 'suspended'`) says so on
// the sign-in page. On a page anyone may see (defaultAccess 'public'), an ended session just leaves the visitor signed
// out where they are; only a suspension goes to sign-in, for the notice. Several 401s at once navigate once.

let ending: Promise<void> | null = null

export function useSessionEnded() {
  const { fetch: fetchSession } = useUserSession()
  const router = useRouter()
  return (reason?: string) => {
    ending ??= (async () => {
      const here = router.currentRoute.value.fullPath
      await fetchSession().catch(() => {})
      const flag = reason === 'suspended' ? { suspended: '1' } : {}
      // Signing out may already have sent them to sign-in; then only add the notice.
      const now = router.currentRoute.value
      if (!flag.suspended && !isMembersOnlyRoute(now)) return
      if (now.path === '/login') {
        if (flag.suspended && !now.query.suspended) await router.replace({ query: { ...now.query, ...flag } })
        return
      }
      await router.replace({ path: '/login', query: { ...(here === '/' ? {} : { redirect: here }), ...flag } })
    })().finally(() => (ending = null))
    return ending
  }
}
