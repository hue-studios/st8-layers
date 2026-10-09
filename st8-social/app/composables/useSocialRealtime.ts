// One shared Directus realtime connection for the whole app (pattern from CardDesk's useWebSocketManager): every
// subscription is multiplexed over a single WebSocket, identical subscriptions share one Directus subscription, and
// the socket is torn down when nothing is subscribed or the member signs out.
//
// Auth is Directus's `handshake` mode with the short-lived access token from st8-auth's GET /api/websocket/token. The
// token is refreshed on the socket before it expires and whenever Directus reports it expired. The connection comes
// back by itself: exponential backoff after a drop, an immediate reconnect when the tab returns, the network comes
// back or the device wakes from sleep (a gap in the timer), and when Directus's pings stop arriving. Every
// (re)subscribe delivers an `init` event, which is subscribers' cue to refetch whatever they may have missed.

export type RealtimeEvent = 'init' | 'create' | 'update' | 'delete'
export type RealtimeHandler = (event: RealtimeEvent, data: Record<string, unknown>[] | string[]) => void

export interface RealtimeQuery {
  fields: string[]
  filter?: Record<string, unknown>
  sort?: string[]
  /** Caps the `init` snapshot; live events still cover every matching row. */
  limit?: number
}

interface Shared {
  uid: string
  collection: string
  query: RealtimeQuery
  handlers: Set<RealtimeHandler>
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const REAUTH_MS = 10 * 60_000 // access tokens last ~15 minutes
const SILENCE_MS = 75_000 // Directus pings every 30s by default
const TICK_MS = 15_000
const SLEEP_GAP_MS = 45_000

let ws: WebSocket | null = null
let authed = false
let attempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reauthTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let lastTick = 0
let lastMessage = 0
let initialised = false
let wsUrl = ''
let loggedInRef: Ref<boolean> | null = null

const subs = new Map<string, Shared>() // key → subscription
const byUid = new Map<string, Shared>()
const connected = ref(false)

const keyOf = (collection: string, query: RealtimeQuery) => `${collection}|${JSON.stringify(query)}`

function init() {
  if (initialised || import.meta.server) return
  initialised = true
  const config = useRuntimeConfig()
  const configured = (config.public.st8Social as { websocketUrl?: string } | undefined)?.websocketUrl
  wsUrl = configured || `${String(config.public.directusUrl).replace(/\/$/, '').replace(/^http/, 'ws')}/websocket`
  const { loggedIn } = useUserSession()
  loggedInRef = loggedIn
  effectScope(true).run(() => watch(loggedIn, (now) => {
    if (!now) teardown(true)
    else if (subs.size) connect()
  }))

  // Resume: the tab came back, the network came back, or the page was restored from the back/forward cache.
  const resume = () => {
    if (!subs.size || !loggedInRef?.value) return
    if (!ws || ws.readyState > WebSocket.OPEN || Date.now() - lastMessage > SILENCE_MS) reconnectNow()
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resume())
  window.addEventListener('online', resume)
  window.addEventListener('pageshow', (e) => e.persisted && reconnectNow())
}

function startTimers() {
  stopTimers()
  lastTick = Date.now()
  tickTimer = setInterval(() => {
    const now = Date.now()
    const slept = now - lastTick > SLEEP_GAP_MS
    lastTick = now
    // After sleep the socket is often a zombie that still reports OPEN; silence from Directus means the same.
    if (slept || (authed && now - lastMessage > SILENCE_MS)) reconnectNow()
  }, TICK_MS)
  reauthTimer = setInterval(() => void authenticate(), REAUTH_MS)
}

function stopTimers() {
  if (tickTimer) clearInterval(tickTimer)
  if (reauthTimer) clearInterval(reauthTimer)
  tickTimer = reauthTimer = null
}

function connect() {
  if (import.meta.server || !loggedInRef?.value || !subs.size) return
  if (ws && ws.readyState <= WebSocket.OPEN) return
  let socket: WebSocket
  try {
    socket = new WebSocket(wsUrl)
  } catch (err) {
    console.warn('[st8-social] realtime connection failed:', err)
    scheduleReconnect()
    return
  }
  ws = socket
  authed = false
  socket.addEventListener('open', () => {
    if (ws !== socket) return
    lastMessage = Date.now()
    void authenticate()
  })
  socket.addEventListener('message', (e) => {
    if (ws !== socket) return
    lastMessage = Date.now()
    onMessage(e)
  })
  socket.addEventListener('close', () => {
    if (ws !== socket) return
    ws = null
    authed = false
    connected.value = false
    stopTimers()
    scheduleReconnect()
  })
  socket.addEventListener('error', () => {
    if (ws !== socket) return
    try { socket.close() } catch { /* already closing */ }
  })
}

function scheduleReconnect() {
  if (reconnectTimer || !subs.size || !loggedInRef?.value) return
  const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!
  attempts++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function reconnectNow() {
  attempts = 0
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  const old = ws
  ws = null
  authed = false
  connected.value = false
  stopTimers()
  if (old) try { old.close(1000, 'reconnect') } catch { /* ignore */ }
  connect()
}

function teardown(clear = false) {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopTimers()
  const old = ws
  ws = null
  authed = false
  connected.value = false
  if (old) try { old.close(1000, 'teardown') } catch { /* ignore */ }
  if (clear) {
    subs.clear()
    byUid.clear()
  }
}

async function authenticate() {
  const socket = ws
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  try {
    const { token } = await $fetch<{ token: string }>('/api/websocket/token', { retry: 0 })
    if (ws === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'auth', access_token: token }))
  } catch {
    // Signed out, or a blip. If the session really ended, the loggedIn watcher tears everything down; otherwise the
    // reconnect tries again with backoff.
    if (ws === socket) {
      ws = null
      try { socket.close() } catch { /* ignore */ }
    }
    scheduleReconnect()
  }
}

function send(message: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function subscribeOnSocket(s: Shared) {
  send({ type: 'subscribe', collection: s.collection, query: s.query, uid: s.uid })
}

function onMessage(e: MessageEvent) {
  let msg: { type?: string, status?: string, event?: string, uid?: string, data?: unknown, error?: { code?: string } }
  try {
    msg = JSON.parse(String(e.data))
  } catch {
    return
  }
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong' })
      return
    case 'auth':
      if (msg.status === 'ok') {
        const first = !authed
        authed = true
        connected.value = true
        attempts = 0
        if (first) {
          startTimers()
          for (const s of subs.values()) subscribeOnSocket(s)
        }
      } else if (msg.error?.code === 'TOKEN_EXPIRED') {
        void authenticate()
      } else {
        console.warn('[st8-social] realtime auth failed:', msg.error?.code ?? msg)
        reconnectNow()
      }
      return
    case 'subscription': {
      if (msg.status === 'error' || !msg.uid) return
      const s = byUid.get(msg.uid)
      if (!s || !['init', 'create', 'update', 'delete'].includes(msg.event ?? '')) return
      const data = (Array.isArray(msg.data) ? msg.data : []) as Record<string, unknown>[] | string[]
      for (const handler of s.handlers) {
        try {
          handler(msg.event as RealtimeEvent, data)
        } catch (err) {
          console.error('[st8-social] realtime handler failed:', err)
        }
      }
      return
    }
    case 'error':
      // A subscription the member's policies don't allow: it stays quiet, the others keep working.
      console.debug('[st8-social] realtime error:', msg.error ?? msg)
  }
}

/**
 * Subscribe to a collection over the shared connection. Returns an unsubscribe function. The handler receives
 * Directus's events: `init` with the current rows (also after every reconnect), then `create`/`update` with rows and
 * `delete` with ids.
 */
function subscribe(collection: string, query: RealtimeQuery, handler: RealtimeHandler): () => void {
  init()
  if (import.meta.server) return () => {}
  const key = keyOf(collection, query)
  let s = subs.get(key)
  if (!s) {
    s = { uid: `${collection}-${Math.random().toString(36).slice(2, 10)}`, collection, query, handlers: new Set() }
    subs.set(key, s)
    byUid.set(s.uid, s)
    if (authed) subscribeOnSocket(s)
    else connect()
  }
  s.handlers.add(handler)
  const shared = s
  return () => {
    shared.handlers.delete(handler)
    if (shared.handlers.size) return
    subs.delete(key)
    byUid.delete(shared.uid)
    send({ type: 'unsubscribe', uid: shared.uid })
    if (!subs.size) teardown()
  }
}

export function useSocialRealtime() {
  init()
  return { subscribe, connected: readonly(connected), reconnect: reconnectNow }
}
