// Sign out: revoke the Directus refresh token and clear the sealed cookie.
export default defineEventHandler(async (event) => {
  await endSession(event)
  return { ok: true }
})
