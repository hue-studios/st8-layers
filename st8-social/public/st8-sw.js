// st8-social's service worker (README, "Push"). It handles two events only: `push` (show the notification, set the app
// icon's badge) and `notificationclick` (mark it read, then open its page in the app). No `fetch` handler and no
// caching, so a signed-in page is never served stale. Served from the app root so its scope is the whole app.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function setBadge(count) {
  const nav = self.navigator
  if (typeof count !== 'number' || !nav || !('setAppBadge' in nav)) return Promise.resolve()
  return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {})
}

self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = {}
  }
  // Every push must show a notification (userVisibleOnly), even one we can't read.
  const title = typeof msg.title === 'string' && msg.title ? msg.title : 'New notification'
  const options = {
    body: typeof msg.body === 'string' ? msg.body : '',
    tag: typeof msg.tag === 'string' && msg.tag ? msg.tag : undefined,
    renotify: typeof msg.tag === 'string' && !!msg.tag,
    icon: msg.icon || undefined,
    badge: msg.badge || undefined,
    timestamp: typeof msg.ts === 'number' ? msg.ts : undefined,
    data: { url: typeof msg.url === 'string' ? msg.url : '/', id: typeof msg.id === 'string' ? msg.id : null },
  }
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), setBadge(msg.count)]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  let target = new URL(data.url || '/', self.location.origin)
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin)
  const path = target.pathname + target.search + target.hash

  event.waitUntil((async () => {
    const read = data.id
      ? fetch('/api/social/notifications/read', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [data.id] }),
        }).then((res) => (res.ok ? res.json() : null)).then((res) => setBadge(res && res.unread)).catch(() => {})
      : Promise.resolve()

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((c) => new URL(c.url).origin === self.location.origin)
    if (open) {
      // The app navigates itself (st8-social's push plugin), so an open page keeps its state; focus first.
      await open.focus().catch(() => {})
      open.postMessage({ type: 'st8-push:open', url: path })
    } else {
      await self.clients.openWindow(path)
    }
    await read
  })())
})
