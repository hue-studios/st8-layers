import type { Driver } from 'unstorage'

// The shared store (one Upstash Redis database for every ST8 app, through Vercel's Marketplace integration). Serverless
// instances don't share memory, so the layers' rate limits and the network's withdraw cooldown live here in
// production; without it each instance counts on its own.
//
// Keys: `<app>:<VERCEL_ENV|local>:<name>:…` for each app's own counters, `st8:<env>:<name>:…` for what is global across
// ST8 (the withdraw cooldown: connections are global). Production, Preview and local runs share one database without
// touching each other's keys.

/** Layer mounts and where they go: `app` = under this app's prefix, `st8` = under the shared ST8 prefix. */
const LAYER_MOUNTS: Record<string, { name: string, scope: 'app' | 'st8' }> = {
  'st8-auth-rate-limit': { name: 'auth-rate-limit', scope: 'app' },
  'st8-social-rate-limit': { name: 'social-rate-limit', scope: 'app' },
  'st8-network-cooldown': { name: 'network-cooldown', scope: 'st8' },
}

/** mount → the key prefix its shared driver was given, so countHit can write the same keys atomically. */
const bases = new Map<string, string>()

export interface SharedStoreOptions {
  /** The unstorage driver factory, e.g. `upstashDriver` from 'unstorage/drivers/upstash' (the host imports it). */
  driver: (options: { url: string, token: string, base: string }) => Driver
  /** Host mounts to move too, mount → name (under this app's prefix), e.g. `{ 'insider-link-preview': 'link-preview' }`. */
  mounts?: Record<string, string>
  /**
   * Default: on when running on Vercel, off locally; env ST8_SHARED_STORE=1 / =0 forces it. Pass a boolean to decide
   * yourself.
   */
  enabled?: boolean
  /** Defaults: KV_REST_API_URL / KV_REST_API_TOKEN (Vercel's Upstash integration), else UPSTASH_REDIS_REST_URL / _TOKEN. */
  url?: string
  token?: string
}

/**
 * Move the layers' storage mounts (and any host mounts named) onto the shared store. Call it from a Nitro plugin, so
 * the token is read from the environment at runtime and never baked into the build:
 *
 *   import upstashDriver from 'unstorage/drivers/upstash'
 *   export default defineNitroPlugin(() => mountSharedStore({ driver: upstashDriver }))
 *
 * Synchronous (unmount without dispose), so the swap is done before the first request is served. Returns the mounts it
 * moved. Nitro's own `cache` mount should stay in memory: cached functions read their storage on every call and swr
 * entries are written without a TTL.
 */
export function mountSharedStore(options: SharedStoreOptions): string[] {
  const flag = process.env.ST8_SHARED_STORE
  const enabled = options.enabled ?? (flag === '1' || (flag !== '0' && !!process.env.VERCEL))
  if (!enabled) return []
  const url = options.url || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = options.token || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    console.warn('[st8-auth] shared store: no KV_REST_API_URL / KV_REST_API_TOKEN, so rate limits stay per instance')
    return []
  }

  const env = process.env.VERCEL_ENV || 'local'
  const app = useSt8Auth().app
  const storage = useStorage()
  const present = new Set(storage.getMounts('').map((m) => m.base.replace(/:$/, '')))
  const wanted: [string, string][] = [
    ...Object.entries(LAYER_MOUNTS).filter(([mount]) => present.has(mount)).map(([mount, m]): [string, string] => [mount, `${m.scope === 'st8' ? 'st8' : app}:${env}:${m.name}`]),
    ...Object.entries(options.mounts ?? {}).map(([mount, name]): [string, string] => [mount, `${app}:${env}:${name}`]),
  ]
  for (const [mount, base] of wanted) {
    void storage.unmount(mount, false)
    storage.mount(mount, options.driver({ url, token, base }))
    bases.set(mount, base)
  }
  console.info(`[st8-auth] shared store: ${wanted.map(([m, b]) => `${m} → ${b}`).join(', ')}`)
  return wanted.map(([m]) => m)
}

// INCR the window's counter and start its expiry on the first hit, in one call, so two instances can never read the
// same count. A key that somehow lost its expiry gets one again. Returns [count, ms until the window resets].
const COUNT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if c == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { c, ttl }
`

interface RateWindow {
  count: number
  /** Epoch ms when the window resets. */
  reset: number
}

/** The Redis client behind a mount, when it's the Upstash or Redis driver; null for memory and anything else. */
function redisOf(mount: string): { name: string, client: { eval: (...args: never[]) => Promise<unknown> } } | null {
  const driver = useStorage().getMount(mount)?.driver as (Driver & { getInstance?: () => unknown }) | undefined
  if (!driver || (driver.name !== 'upstash' && driver.name !== 'redis')) return null
  const client = driver.getInstance?.() as { eval?: (...args: never[]) => Promise<unknown> } | undefined
  return client?.eval ? { name: driver.name, client: client as { eval: (...args: never[]) => Promise<unknown> } } : null
}

/**
 * Count one hit on `key` in a fixed window of `windowSec` in storage mount `mount`. On a shared Redis/Upstash mount the
 * increment is one atomic call; in memory (one instance) it's a read and a write with nothing in between. Returns the
 * count so far in this window and when it resets. Throws if the store fails; callers decide whether that blocks.
 */
export async function countHit(mount: string, key: string, windowSec: number): Promise<{ count: number, reset: number }> {
  const now = Date.now()
  const redis = redisOf(mount)
  if (redis) {
    const full = `${bases.get(mount) ?? `st8:counters:${mount}`}:${key}`
    const ms = String(windowSec * 1000)
    const result = redis.name === 'upstash'
      ? await (redis.client.eval as unknown as (s: string, k: string[], a: string[]) => Promise<[number, number]>)(COUNT_SCRIPT, [full], [ms])
      : await (redis.client.eval as unknown as (s: string, n: number, ...a: string[]) => Promise<[number, number]>)(COUNT_SCRIPT, 1, full, ms)
    const [count, ttl] = result.map(Number) as [number, number]
    return { count, reset: now + Math.max(ttl, 0) }
  }
  // In memory: one hit at a time per key on this instance, so two requests can't both read the same count.
  const lockKey = `${mount}:${key}`
  const run = (chains.get(lockKey) ?? Promise.resolve()).then(async () => {
    const storage = useStorage<RateWindow>(mount)
    const stored = await storage.getItem(key)
    const current = stored && stored.reset > now ? { count: stored.count + 1, reset: stored.reset } : { count: 1, reset: now + windowSec * 1000 }
    await storage.setItem(key, current, { ttl: windowSec })
    return current
  })
  const tail = run.catch(() => {})
  chains.set(lockKey, tail)
  void tail.then(() => chains.get(lockKey) === tail && chains.delete(lockKey))
  return run
}

const chains = new Map<string, Promise<unknown>>()
