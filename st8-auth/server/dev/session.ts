// Development only (registered under $development in the layer's nuxt.config.ts), for testing refresh without waiting
// out the Directus TTL. Never returns a token.
//   GET  → { user, expires_in_ms, membership, directus, social_read } (directus: does Directus accept the session's
//          access token? social_read: can that token read `threads`, which only the ST8 Social policy allows?)
//   POST → mark the access token expired, so the next authenticated request refreshes it
//   POST ?break=refresh → also replace the refresh token with a dead one, to exercise the "refresh rejected" path
import { readItems, readMe } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  const session = await getUserSession(event)
  if (!session.secure) throw createError({ statusCode: 401, message: 'Not signed in' })

  if (event.method === 'POST') {
    const broken = getQuery(event).break === 'refresh'
    await setUserSession(event, {
      secure: { ...session.secure, expires_at: Date.now() - 1000, ...(broken ? { refresh_token: 'revoked-for-test' } : {}) },
    })
  }
  const current = await getUserSession(event)
  let directus = 'skipped (token marked expired)'
  let social_read = directus
  if ((current.secure?.expires_at ?? 0) > Date.now()) {
    const client = getUserDirectus(current.secure!.access_token)
    directus = await client
      .request(readMe({ fields: ['id'] }))
      .then((me) => (me.id === current.user?.id ? 'accepted' : 'wrong user'))
      .catch((err) => `rejected (${directusError(err).status})`)
    social_read = await client
      .request(readItems('threads', { fields: ['id'], limit: 1 }))
      .then(() => 'allowed')
      .catch((err) => `refused (${directusError(err).status})`)
  }
  return {
    directus,
    social_read,
    user: current.user?.email,
    expires_in_ms: (current.secure?.expires_at ?? 0) - Date.now(),
    membership: current.secure?.membership ?? null,
  }
})
