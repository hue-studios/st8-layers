import type { PushState } from '../../shared/types/push'

// Push on this device (README, "Push"): whether the browser can, whether it's on for this member, and the switch's
// actions. Permission is asked only from enable(), i.e. from the member's tap; never on load. One state per app.

/**
 * `supported`: the switch works. `install`: iPhone or iPad in a Safari tab, where push only reaches a Home Screen app.
 * `unsupported`: this browser can't receive push (or push is off in this app).
 */
export type PushSupport = 'supported' | 'install' | 'unsupported'

const state = reactive({
  /** The first check is done (until then the switch shows nothing definite). */
  ready: false,
  configured: false,
  support: 'unsupported' as PushSupport,
  permission: 'default' as NotificationPermission,
  enabled: false,
  busy: false,
  error: null as string | null,
})

const bytesOf = (b64url: string) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function sameKey(sub: PushSubscription, publicKey: string) {
  const have = sub.options?.applicationServerKey
  if (!have) return true // older browsers don't say; trust it
  const a = new Uint8Array(have)
  const b = bytesOf(publicKey)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export function isIosDevice() {
  if (import.meta.server) return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone() {
  if (import.meta.server) return false
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function detect(): PushSupport {
  if (isIosDevice() && !isStandalone()) return 'install'
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'supported' : 'unsupported'
}

function config() {
  const push = (useRuntimeConfig().public.st8Social as { push?: { vapidPublicKey?: string, serviceWorker?: string } } | undefined)?.push
  return { publicKey: push?.vapidPublicKey ?? '', serviceWorker: push?.serviceWorker || '/st8-sw.js' }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

function failure(err: unknown, fallback: string) {
  const e = err as { data?: { message?: string }, message?: string, name?: string }
  if (e?.name === 'NotAllowedError') return 'Notifications are blocked for this site.'
  return e?.data?.message || fallback
}

async function send(path: 'subscribe' | 'unsubscribe' | 'status', body: Record<string, unknown>) {
  return $fetch<PushState>(`/api/social/push/${path}`, { method: 'POST', body })
}

// Windows of one browser share its service worker and subscription: a browser tab and the installed app are one device.
// A change in one is announced to the others, which recheck (or, after a sign-out, just turn off).
let channel: BroadcastChannel | null = null
function windows() {
  if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('st8-social-push')
  return channel
}
function announce(type: 'changed' | 'forgotten') {
  try {
    windows()?.postMessage({ type })
  } catch {
    // Another window catches up when it's next shown.
  }
}

/** Re-read the device's state (on load, and when the app comes back). Quietly re-subscribes after a key change. */
async function refresh() {
  if (import.meta.server) return
  const { publicKey } = config()
  state.configured = !!publicKey
  state.support = state.configured ? detect() : 'unsupported'
  state.permission = 'Notification' in window ? Notification.permission : 'default'
  try {
    if (state.support !== 'supported') {
      state.enabled = false
      return
    }
    let sub = await currentSubscription()
    if (sub && !sameKey(sub, publicKey)) {
      // The app's key changed: the old subscription can't be pushed to. Make a new one if we may.
      await sub.unsubscribe().catch(() => {})
      sub = null
      if (state.permission === 'granted') {
        const reg = await navigator.serviceWorker.ready
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesOf(publicKey) })
        await send('subscribe', sub.toJSON() as Record<string, unknown>)
      }
    }
    const res = await send('status', { endpoint: sub?.endpoint })
    state.configured = res.configured
    state.enabled = res.enabled && !!sub && state.permission === 'granted'
  } catch (err) {
    console.warn('[st8-social] push status failed:', (err as Error)?.message ?? err)
  } finally {
    state.ready = true
  }
}

/** Turn push on for this device. Call it straight from the tap: iOS only shows the permission prompt from a gesture. */
async function enable() {
  if (state.busy || state.support !== 'supported') return
  state.busy = true
  state.error = null
  try {
    const permission = await Notification.requestPermission()
    state.permission = permission
    if (permission !== 'granted') return
    const { publicKey, serviceWorker } = config()
    await navigator.serviceWorker.register(serviceWorker, { scope: '/' })
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (sub && !sameKey(sub, publicKey)) {
      await sub.unsubscribe().catch(() => {})
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesOf(publicKey) })
    state.enabled = (await send('subscribe', sub.toJSON() as Record<string, unknown>)).enabled
    announce('changed')
  } catch (err) {
    state.error = failure(err, 'Couldn\'t turn notifications on. Try again.')
  } finally {
    state.busy = false
  }
}

/** Turn push off for this device. */
async function disable() {
  if (state.busy) return
  state.busy = true
  state.error = null
  try {
    const sub = await currentSubscription()
    if (sub) {
      await send('unsubscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe().catch(() => {})
    }
    state.enabled = false
    announce('changed')
  } catch (err) {
    state.error = failure(err, 'Couldn\'t turn notifications off. Try again.')
  } finally {
    state.busy = false
  }
}

/** Signing out: this browser's subscription goes (the server drops its row with the session). */
async function forgetDevice() {
  if (import.meta.server || !('serviceWorker' in navigator)) return
  try {
    const sub = await currentSubscription()
    await sub?.unsubscribe()
  } catch {
    // The server row is gone anyway; a stale browser subscription is never pushed to.
  }
  state.enabled = false
  announce('forgotten')
}

/**
 * Keep this window's switch current (the push plugin calls it once): another window of this browser turned it on or
 * off, or the permission changed in the browser's or the system's settings.
 */
function follow(onChange: () => void) {
  if (import.meta.server) return
  const ch = windows()
  if (ch) {
    ch.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'forgotten') state.enabled = false
      else if (event.data?.type === 'changed') onChange()
    }
  }
  navigator.permissions?.query({ name: 'notifications' as PermissionName })
    .then((status) => {
      status.onchange = () => onChange()
    })
    .catch(() => {}) // not every browser can watch it; the next return to the window rechecks
}

export function useSocialPush() {
  return { state: readonly(state), refresh, enable, disable, forgetDevice, follow }
}
