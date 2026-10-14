// Push in the page (README, "Push"): the device's state for the switch, a tapped notification opened in this window,
// and the device forgotten at sign-out (useSocialNotifications keeps the app icon's badge). Nothing runs, and no service
// worker is registered, while push is off in this app (no VAPID public key).
export default defineNuxtPlugin((nuxtApp) => {
  const push = (useRuntimeConfig().public.st8Social as { push?: { vapidPublicKey?: string } } | undefined)?.push
  if (!push?.vapidPublicKey) return
  const { loggedIn } = useUserSession()
  const { refresh, forgetDevice, follow } = useSocialPush()

  nuxtApp.hook('st8-auth:sign-out', forgetDevice)

  // The service worker asks an open window to go to a tapped notification's page.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string, url?: unknown } | null
      if (data?.type !== 'st8-push:open' || typeof data.url !== 'string' || !data.url.startsWith('/') || data.url.startsWith('//')) return
      void navigateTo(data.url)
    })
    navigator.serviceWorker.startMessages()
  }

  // On sign-in, when another window of this browser changes it, when the permission changes, and each time the app
  // comes back (the member may have changed it in a window that couldn't tell this one, or in the browser's settings).
  let checked = 0
  const check = () => {
    checked = Date.now()
    void refresh()
  }
  watch(loggedIn, (ok) => {
    if (ok) check()
  }, { immediate: true })
  follow(() => {
    if (loggedIn.value) check()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loggedIn.value && Date.now() - checked > 2000) check()
  })
})
