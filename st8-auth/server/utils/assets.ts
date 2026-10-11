import type { H3Event } from 'h3'

/**
 * Streams a Directus file to the browser with the server account, for files that aren't public (Member avatars, an app's
 * own private folders). The caller decides who may see it first. `transform` is passed to /assets as is (e.g. a square
 * WebP).
 */
export async function streamDirectusAsset(event: H3Event, id: string, { transform, cache }: { transform?: Record<string, string | number>, cache: string }) {
  const config = useRuntimeConfig()
  const token = (config as { directusServerToken?: string }).directusServerToken || process.env.DIRECTUS_SERVER_TOKEN
  const query = transform ? `?${new URLSearchParams(Object.entries(transform).map(([k, v]) => [k, String(v)]))}` : ''
  const url = `${String(config.public.directusUrl).replace(/\/$/, '')}/assets/${id}${query}`
  // A busy Directus (429, 503) is retried like an SDK error and still busy answers 503; any other failure is a 404.
  const res = await retryDirectusBusy(async () => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (r.status === 429 || r.status === 503) {
      const body = await r.json().catch(() => null) as { errors?: unknown[] } | null
      throw Object.assign(new Error(`Directus ${r.status}`), { status: r.status, errors: body?.errors, response: r })
    }
    return r
  }).catch((err) => {
    if ((err as { statusCode?: number }).statusCode === 503) throw err
    return null
  })
  if (!res?.ok || !res.body) throw createError({ statusCode: 404, message: 'Not found' })
  setResponseHeaders(event, {
    'Content-Type': res.headers.get('content-type') ?? 'image/webp',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
    ...(res.headers.get('content-length') ? { 'Content-Length': res.headers.get('content-length')! } : {}),
  })
  return sendStream(event, res.body)
}
