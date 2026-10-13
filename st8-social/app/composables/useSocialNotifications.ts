import type { NotificationPage, SocialNotification } from '../../shared/types/social'

// The signed-in member's notifications: the unread count for the bell and the list it opens. A realtime subscription
// to their own notifications (recipient = $CURRENT_USER, which is also all their policy lets them read) refreshes
// both when one arrives or is read elsewhere. One instance per app; the bell starts it.

const items = ref<SocialNotification[]>([])
const unread = ref(0)
const next = ref<string | null>(null)
const loading = ref(false)
const loaded = ref(false)
let started = false
let unsubscribe: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

async function load(more = false) {
  loading.value = true
  try {
    const page = await $fetch<NotificationPage>('/api/social/notifications', { query: { limit: 20, before: more ? next.value ?? undefined : undefined } })
    items.value = more ? [...items.value, ...page.items.filter((n) => !items.value.some((m) => m.id === n.id))] : page.items
    unread.value = page.unread
    next.value = page.next
    loaded.value = true
  } catch (err) {
    console.warn('[st8-social] notifications failed:', (err as Error)?.message ?? err)
  } finally {
    loading.value = false
  }
}

function refreshSoon() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void load(), 300)
}

/**
 * The app icon's badge follows the unread count where the browser has one (installed Chrome and Edge, iOS Home Screen
 * apps). Only while push is set up in this app: a push sets it too, and both should agree.
 */
function followBadge(loggedIn: Ref<boolean>) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>, clearAppBadge?: () => Promise<void> }
  const push = (useRuntimeConfig().public.st8Social as { push?: { vapidPublicKey?: string } } | undefined)?.push
  if (!nav.setAppBadge || !nav.clearAppBadge || !push?.vapidPublicKey) return
  watch([loggedIn, unread], ([ok, n]) => {
    const count = ok ? n : 0
    void (count ? nav.setAppBadge!(count) : nav.clearAppBadge!()).catch(() => {})
  }, { immediate: true })
}

function start() {
  if (started || import.meta.server) return
  started = true
  const { loggedIn } = useUserSession()
  effectScope(true).run(() => followBadge(loggedIn))
  // App-wide, not tied to the component that started it (the bell unmounts on auth pages).
  effectScope(true).run(() => watch(loggedIn, (ok) => {
    unsubscribe?.()
    unsubscribe = null
    if (!ok) {
      items.value = []
      unread.value = 0
      loaded.value = false
      return
    }
    void load()
    let inits = 0
    unsubscribe = useSocialRealtime().subscribe(
      'notifications',
      { fields: ['id', 'read_at'], filter: { recipient: { _eq: '$CURRENT_USER' } }, sort: ['-date_created'], limit: 1 },
      (event) => {
        if (event === 'init' && inits++ === 0) return // the first snapshot: load() just ran
        refreshSoon()
      },
    )
  }, { immediate: true }))
}

async function markRead(ids: string[] | 'all') {
  const before = { items: items.value, unread: unread.value }
  const all = ids === 'all'
  items.value = items.value.map((n) => (all || ids.includes(n.id) ? { ...n, read: true } : n))
  unread.value = all ? 0 : Math.max(0, unread.value - before.items.filter((n) => !n.read && ids.includes(n.id)).length)
  try {
    const res = await $fetch<{ unread: number }>('/api/social/notifications/read', { method: 'POST', body: all ? { all: true } : { ids } })
    unread.value = res.unread
  } catch {
    items.value = before.items
    unread.value = before.unread
  }
}

export function useSocialNotifications() {
  start()
  return {
    items: readonly(items),
    unread: readonly(unread),
    loading: readonly(loading),
    loaded: readonly(loaded),
    hasMore: computed(() => !!next.value),
    load,
    loadMore: () => load(true),
    markRead,
  }
}
