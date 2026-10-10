/**
 * Fixed-window rate limit. Counts live in the 'st8-auth-rate-limit' storage mount: memory (per instance) unless the
 * host moves it to the shared store (mountSharedStore), where each hit is one atomic increment. Throws 429 with
 * Retry-After once `key` passes `max` hits in `windowSec`. A storage failure never blocks sign-in; it only skips the
 * count.
 */
export async function enforceRateLimit(event: AuthEvent, key: string, max: number, windowSec: number) {
  const now = Date.now()
  let current: { count: number, reset: number }
  try {
    current = await countHit('st8-auth-rate-limit', key, windowSec)
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
