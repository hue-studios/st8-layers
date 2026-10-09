/**
 * "Is my session still alive?", pinged by app/plugins/session-resume.client.ts when the app returns to the foreground.
 * Refreshes the access token if it's near expiry, slides the session window, and every few minutes re-reads the
 * membership (a suspension signs the member out) and the session user. 401 means the session is gone.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = await revalidateSession(event)
  return { ok: true, user }
})
