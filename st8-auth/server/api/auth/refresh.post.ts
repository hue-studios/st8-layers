// Force a token refresh now (the app normally refreshes on demand in getValidToken).
export default defineEventHandler(async (event) => {
  await getValidToken(event, { force: true })
  return { ok: true }
})
