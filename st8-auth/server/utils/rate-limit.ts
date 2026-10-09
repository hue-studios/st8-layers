interface RateWindow {
  count: number
  /** Epoch ms when the window resets. */
  reset: number
}

/**
 * Fixed-window rate limit. Counts live in the 'st8-auth-rate-limit' storage mount: memory (per instance) unless the
 * host mounts a shared driver, see nuxt.config.ts. Throws 429 with Retry-After once `key` passes `max` hits in
 * `windowSec`. A storage failure never blocks sign-in; it only skips the count.
 */
export async function enforceRateLimit(event: AuthEvent, key: string, max: number, windowSec: number) {
  const storage = useStorage<RateWindow>('st8-auth-rate-limit')
  const now = Date.now()
  let current: RateWindow
  try {
    const stored = await storage.getItem(key)
    current = stored && stored.reset > now ? { count: stored.count + 1, reset: stored.reset } : { count: 1, reset: now + windowSec * 1000 }
    await storage.setItem(key, current, { ttl: windowSec })
  } catch (err) {
    console.warn('[st8-auth] rate-limit storage failed; not counting:', (err as Error)?.message ?? err)
    return
  }
  if (current.count > max) {
    const retryAfter = Math.max(1, Math.ceil((current.reset - now) / 1000))
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({
      statusCode: 429,
      message: `Too many attempts. Try again in ${retryAfter > 90 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} seconds`}.`,
    })
  }
}
