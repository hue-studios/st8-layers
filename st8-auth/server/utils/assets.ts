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
  const res = await fetch(`${String(config.public.directusUrl).replace(/\/$/, '')}/assets/${id}${query}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok || !res.body) throw createError({ statusCode: 404, message: 'Not found' })
  setResponseHeaders(event, {
    'Content-Type': res.headers.get('content-type') ?? 'image/webp',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
    ...(res.headers.get('content-length') ? { 'Content-Length': res.headers.get('content-length')! } : {}),
  })
  return sendStream(event, res.body)
}
