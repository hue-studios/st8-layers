import type { NotificationType } from '../../shared/types/social'
import type { PushMessage, PushState } from '../../shared/types/push'
import { type SocialEvent, create, isUniqueViolation, limitRate, one, readJson, remove, rows, socialContext, sys, update, withLock } from './core'
import { activeMembers } from './people'
import { MAX_PAYLOAD, type VapidKeys, encryptPayload, topicOf, validSubscriptionKeys, vapidAuthorization } from './push-crypto'

// Web Push (README, "Push"). A member turns it on per device; each notification `notify()` creates for them is then
// also sent to every device they turned it on for in this app, off the request path. Server account only: members'
// tokens can't read `push_subscriptions`, and an endpoint never goes back to the browser.

const C = 'push_subscriptions'
const DEFAULT_TYPES: NotificationType[] = ['reply', 'mention', 'connection_request', 'connection_accepted', 'intro', 'moderation', 'report']

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  last_seen: string | null
  failures: number | null
}

/** Push config with defaults. Off unless the VAPID pair and subject are set. */
export function pushConfig() {
  const rc = useRuntimeConfig()
  const push = ((rc.st8Social as { push?: Record<string, unknown> } | undefined)?.push ?? {}) as Partial<{
    vapidPrivateKey: string
    subject: string
    types: string[]
    maxDevices: number
    unseenDays: number
    maxFailures: number
    ttlSeconds: number
    limits: Record<string, number[]>
  }>
  const pub = ((rc.public.st8Social as { push?: Record<string, unknown> } | undefined)?.push ?? {}) as Partial<{ vapidPublicKey: string, icon: string, badge: string }>
  const keys: VapidKeys = { publicKey: String(pub.vapidPublicKey ?? ''), privateKey: String(push.vapidPrivateKey ?? ''), subject: String(push.subject ?? '') }
  return {
    enabled: !!keys.publicKey && !!keys.privateKey && /^(mailto:|https:)/.test(keys.subject),
    keys,
    types: (push.types?.length ? push.types : DEFAULT_TYPES) as string[],
    maxDevices: Math.max(Number(push.maxDevices ?? 10), 1),
    unseenDays: Math.max(Number(push.unseenDays ?? 30), 1),
    maxFailures: Math.max(Number(push.maxFailures ?? 5), 1),
    ttlSeconds: Math.max(Number(push.ttlSeconds ?? 86400), 0),
    limits: { subscribe: [20, 3600], status: [60, 60], recipient: [20, 600], ...push.limits } as Record<'subscribe' | 'status' | 'recipient', [number, number]>,
    icon: String(pub.icon ?? ''),
    badge: String(pub.badge ?? ''),
  }
}

// ── Endpoints (SSRF) ───────────────────────────────────────────────────────────────────────────────────────────
// The server POSTs to a URL a browser handed it, so only the browsers' push services are accepted, on https and the
// default port, and redirects are never followed. Checked on subscribe and again before every send.

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/]

/**
 * Dev builds only: NUXT_ST8_SOCIAL_PUSH_DEV_ENDPOINT (an http origin on a loopback address, e.g. the push probe's
 * http://127.0.0.1:3191) is accepted too. Production builds don't contain this.
 */
function devOrigin(): string | null {
  if (!import.meta.dev) return null
  const raw = process.env.NUXT_ST8_SOCIAL_PUSH_DEV_ENDPOINT
  if (!raw) return null
  try {
    const url = new URL(raw)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port ? url.origin : null
  } catch {
    return null
  }
}

/** The endpoint as given when it's a known push service (or the dev override), else null. */
export function allowedEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 1024) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password || url.hash) return null
  const dev = devOrigin()
  if (dev && url.origin === dev) return raw
  if (url.protocol !== 'https:' || url.port !== '') return null
  return PUSH_HOSTS.some((host) => host.test(url.hostname)) ? raw : null
}

// ── Off the request path ───────────────────────────────────────────────────────────────────────────────────────
// notify() has no event, so the send is handed to Vercel's per-request waitUntil (what @vercel/functions' waitUntil
// reads), which keeps the function alive until it settles. On Vercel without that context the caller awaits it (slower,
// never lost); on a long-running server (dev, a droplet) it just runs.

const VERCEL_REQUEST_CONTEXT = Symbol.for('@vercel/request-context')
let modeLogged = false

function inBackground(task: Promise<void>): Promise<void> | undefined {
  const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[VERCEL_REQUEST_CONTEXT]?.get?.()
  const mode = typeof ctx?.waitUntil === 'function' ? 'waitUntil' : process.env.VERCEL ? 'inline' : 'detached'
  if (!modeLogged && process.env.VERCEL) {
    modeLogged = true
    console.info(`[st8-social] push: sending ${mode === 'waitUntil' ? 'after the response (waitUntil)' : 'before the response (no request context)'}`)
  }
  if (mode === 'waitUntil') {
    ctx!.waitUntil!(task)
    return undefined
  }
  return mode === 'inline' ? task : undefined
}

// ── Sending ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PushNotificationRow {
  recipient: string
  type: NotificationType
}

/**
 * Push one notification to the recipient's devices in this app. `message` builds the payload; it runs only when there
 * is somewhere to send it. Returns a promise only when the caller must wait for it (see inBackground). Never throws.
 */
export function queuePush(row: PushNotificationRow, message: () => Promise<PushMessage | null>) {
  const cfg = pushConfig()
  if (!cfg.enabled || !cfg.types.includes(row.type)) return undefined
  return inBackground(deliver(row, message, cfg).catch((err) => {
    console.error('[st8-social] push not sent:', row.type, directusError(err).message ?? err)
  }))
}

async function deliver(row: PushNotificationRow, message: () => Promise<PushMessage | null>, cfg: ReturnType<typeof pushConfig>) {
  const app = useSt8Social().app
  const subs = await rows<PushSubscriptionRow>(sys(), C, {
    fields: ['id', 'endpoint', 'p256dh', 'auth', 'last_seen', 'failures'],
    filter: { user: { _eq: row.recipient }, app: { _eq: app } },
    limit: 50,
  })
  if (!subs.length) return

  // A burst (a busy thread) stops buzzing after `recipient` pushes in its window; the bell still has everything.
  const [max, windowSec] = cfg.limits.recipient
  const hits = await countHit('st8-social-rate-limit', `push:${row.recipient}`, windowSec).catch(() => ({ count: 0 }))
  if (hits.count > max) {
    if (hits.count === max + 1) console.warn('[st8-social] push: recipient over', max, 'pushes in', windowSec, 's; bell only for now')
    return
  }

  // Left, suspended or no longer an active account: their devices go (the membership listener usually got there first).
  if (!(await activeMembers([row.recipient])).has(row.recipient)) {
    await removeSubscriptions(subs.map((s) => s.id))
    return
  }

  const cutoff = Date.now() - cfg.unseenDays * 86_400_000
  const stale = subs.filter((s) => (s.last_seen && Date.parse(s.last_seen) < cutoff) || !allowedEndpoint(s.endpoint))
  if (stale.length) await removeSubscriptions(stale.map((s) => s.id))
  const live = subs.filter((s) => !stale.includes(s))
  if (!live.length) return

  const msg = await message()
  if (!msg) return
  const payload = new TextEncoder().encode(JSON.stringify(msg))
  if (payload.length > MAX_PAYLOAD) throw new Error(`payload ${payload.length} bytes`)
  const topic = msg.tag ? await topicOf(msg.tag) : null
  const urgency = row.type === 'connection_request' || row.type === 'report' ? 'high' : 'normal'
  await Promise.all(live.map((s) => sendOne(s, payload, { topic, urgency }, cfg)))
}

async function sendOne(sub: PushSubscriptionRow, payload: Uint8Array<ArrayBuffer>, opts: { topic: string | null, urgency: string }, cfg: ReturnType<typeof pushConfig>) {
  let status = 0
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Authorization': await vapidAuthorization(sub.endpoint, cfg.keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(cfg.ttlSeconds),
        'Urgency': opts.urgency,
        ...(opts.topic ? { Topic: opts.topic } : {}),
      },
      body: await encryptPayload(payload, sub),
    })
    status = res.status
    await res.body?.cancel().catch(() => {})
  } catch (err) {
    console.warn('[st8-social] push: send failed:', (err as Error)?.message ?? err)
  }

  try {
    if (status >= 200 && status < 300) {
      await update(C, sub.id, { failures: 0, last_sent: new Date().toISOString() })
    } else if (status === 404 || status === 410) {
      await remove(C, sub.id) // the browser unsubscribed or the subscription expired
    } else {
      // 401/403 (a key mismatch) is counted, not deleted at once, so a wrong key can't wipe every device in one go.
      if (status === 401 || status === 403) console.error('[st8-social] push: the push service refused our VAPID key', status)
      else if (status) console.warn('[st8-social] push: push service answered', status)
      const failures = (sub.failures ?? 0) + 1
      if (failures >= cfg.maxFailures) await remove(C, sub.id)
      else await update(C, sub.id, { failures })
    }
  } catch (err) {
    console.error('[st8-social] push: subscription not updated:', directusError(err).message ?? err)
  }
}

async function removeSubscriptions(ids: string[]) {
  await Promise.all(ids.map((id) => remove(C, id)))
}

// ── Removal paths ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every device of `user` in this app (a suspension, an ended membership). Never throws. */
export async function removeUserSubscriptions(user: string) {
  try {
    const list = await rows<{ id: string }>(sys(), C, { fields: ['id'], filter: { user: { _eq: user }, app: { _eq: useSt8Social().app } }, limit: -1 })
    await removeSubscriptions(list.map((s) => s.id))
  } catch (err) {
    console.error('[st8-social] push: subscriptions not removed:', directusError(err).message ?? err)
  }
}

/** The device a session subscribed from (sign-out). Never throws. */
export async function removeSessionSubscription(session: { user?: { id?: string }, secure?: { push_subscription?: string | null } } | null | undefined) {
  const id = session?.secure?.push_subscription
  const user = session?.user?.id
  if (!id || !user || !pushConfig().enabled) return
  try {
    const row = await one<{ id: string }>(sys(), C, { fields: ['id'], filter: { id: { _eq: id }, user: { _eq: user } } })
    if (row) await remove(C, row.id)
  } catch (err) {
    console.error('[st8-social] push: sign-out subscription not removed:', directusError(err).message ?? err)
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────────────────────────────────────

function requirePush() {
  const cfg = pushConfig()
  if (!cfg.enabled) throw createError({ statusCode: 404, message: 'Push notifications are off in this app.' })
  return cfg
}

/** "Chrome on macOS": enough to tell devices apart in the Studio. */
export function shortAgent(ua: string | undefined) {
  if (!ua) return null
  const browser = /Edg(A|iOS)?\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone/.test(ua) ? 'iOS' : /iPad/.test(ua) ? 'iPadOS' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null
  return (os ? `${browser} on ${os}` : browser).slice(0, 60)
}

/** POST /api/social/push/subscribe: the browser's PushSubscription (toJSON()). */
export async function subscribe(event: SocialEvent): Promise<PushState> {
  const ctx = await socialContext(event)
  const cfg = requirePush()
  await limitRate(event, `push-subscribe:${ctx.me}`, cfg.limits.subscribe, 'Too many changes to notifications.')
  const body = await readJson<{ endpoint: unknown, keys: { p256dh?: unknown, auth?: unknown } }>(event)
  const endpoint = allowedEndpoint(body.endpoint)
  if (!endpoint) throw createError({ statusCode: 400, message: 'This browser\'s push service isn\'t supported.' })
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !(await validSubscriptionKeys(p256dh, auth))) {
    throw createError({ statusCode: 400, message: 'The subscription\'s keys are invalid.' })
  }

  const app = useSt8Social().app
  const data = { user: ctx.me, app, p256dh, auth, user_agent: shortAgent(getRequestHeader(event, 'user-agent')), last_seen: new Date().toISOString(), failures: 0 }
  // One row per endpoint: a device someone else turned it on for (a shared computer) now belongs to this member.
  const id = await withLock(`push:${endpoint}`, async () => {
    const existing = await one<{ id: string }>(sys(), C, { fields: ['id'], filter: { endpoint: { _eq: endpoint } } })
    if (existing) {
      await update(C, existing.id, data)
      return existing.id
    }
    try {
      return (await create<{ id: string }>(C, { ...data, endpoint }, ['id'])).id
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const again = await one<{ id: string }>(sys(), C, { fields: ['id'], filter: { endpoint: { _eq: endpoint } } })
      if (!again) throw err
      await update(C, again.id, data)
      return again.id
    }
  })

  // At most maxDevices per member here: the ones seen longest ago go.
  const mine = await rows<{ id: string }>(sys(), C, { fields: ['id'], filter: { user: { _eq: ctx.me }, app: { _eq: app } }, sort: ['-last_seen', '-date_created'], limit: 200 })
  await removeSubscriptions(mine.slice(cfg.maxDevices).map((s) => s.id).filter((s) => s !== id))

  await setUserSession(event, { secure: { push_subscription: id } } as Parameters<typeof setUserSession>[1])
  return { configured: true, enabled: true }
}

/** POST /api/social/push/unsubscribe: `{ endpoint }`, the member's own rows only. */
export async function unsubscribe(event: SocialEvent): Promise<PushState> {
  const ctx = await socialContext(event)
  const cfg = requirePush()
  await limitRate(event, `push-subscribe:${ctx.me}`, cfg.limits.subscribe, 'Too many changes to notifications.')
  const body = await readJson<{ endpoint: unknown }>(event)
  if (typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 1024) throw createError({ statusCode: 400, message: 'Pass the subscription\'s `endpoint`.' })
  const list = await rows<{ id: string }>(sys(), C, { fields: ['id'], filter: { endpoint: { _eq: body.endpoint }, user: { _eq: ctx.me } }, limit: 5 })
  await removeSubscriptions(list.map((s) => s.id))
  return { configured: true, enabled: false }
}

/**
 * POST /api/social/push/status: `{ endpoint? }` (this device's, when it has one). Whether push is on in this app and on
 * this device for this member. Also notes the device was seen (at most daily), which keeps it from being dropped, and
 * drops a row another member left on this browser.
 */
export async function status(event: SocialEvent): Promise<PushState> {
  const ctx = await socialContext(event)
  const cfg = pushConfig()
  if (!cfg.enabled) return { configured: false, enabled: false }
  await limitRate(event, `push-status:${ctx.me}`, cfg.limits.status, 'Too many requests.')
  const body = await readJson<{ endpoint: unknown }>(event).catch(() => ({} as { endpoint?: unknown }))
  if (typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 1024) return { configured: true, enabled: false }
  const row = await one<{ id: string, user: string, last_seen: string | null }>(sys(), C, {
    fields: ['id', 'user', 'last_seen'],
    filter: { endpoint: { _eq: body.endpoint }, app: { _eq: useSt8Social().app } },
  })
  if (!row) return { configured: true, enabled: false }
  if (row.user !== ctx.me) {
    // Someone else turned it on in this browser and their session lapsed without signing out: their notifications
    // must not keep reaching the person using it now.
    await remove(C, row.id)
    return { configured: true, enabled: false }
  }
  if (!row.last_seen || Date.now() - Date.parse(row.last_seen) > 86_400_000) {
    await update(C, row.id, { last_seen: new Date().toISOString() }).catch(() => {})
  }
  return { configured: true, enabled: true }
}
