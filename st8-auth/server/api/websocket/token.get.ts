/**
 * A short-lived Directus access token for the realtime WebSocket handshake (Phase 4+). This is the one place a token
 * reaches the browser: only the access token (≈15 min), never the refresh token, only to a same-origin request, and
 * never cached. The browser re-fetches it on reconnect.
 */
export default defineEventHandler(async (event) => {
  const site = getRequestHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin') throw createError({ statusCode: 403, message: 'Forbidden' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const token = await getValidToken(event)
  return { token }
})
