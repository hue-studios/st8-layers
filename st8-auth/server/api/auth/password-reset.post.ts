import { readItems, updateItem, updateUser } from '@directus/sdk'

/**
 * Finish a password reset: check the token minted by password-request (exists, unused, unexpired), set the new
 * password with the server token, then burn this and every other open token for the user.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown, password?: unknown }>(event)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  assertPassword(body?.password)
  const password = body.password as string

  await enforceRateLimit(event, `reset:ip:${clientIp(event)}`, 20, 15 * 60)

  const invalid = () => createError({ statusCode: 400, data: { reason: 'invalid_token' }, message: 'This reset link is invalid or has expired. Request a new one.' })
  if (!/^[a-f0-9]{64}$/.test(token)) throw invalid()

  const directus = getDirectus()
  const [row] = await directus.request(
    readItems('password_reset_tokens', { fields: ['id', 'user', 'expires_at', 'used_at', 'app'], filter: { token: { _eq: token } }, limit: 1 }),
  )
  if (!row || row.used_at || !row.expires_at || new Date(row.expires_at).getTime() < Date.now()) throw invalid()
  const userId = typeof row.user === 'string' ? row.user : null
  if (!userId) throw invalid()

  try {
    await directus.request(updateUser(userId, { password }))
  } catch (err) {
    const { status, code, message } = directusError(err)
    if (code === 'FAILED_VALIDATION') throw createError({ statusCode: 400, message: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
    if (status === 403) {
      // The service account may not set passwords on administrators or service accounts (by design: a leaked server
      // token can't take them over). Those reset through Directus itself.
      await directus.request(updateItem('password_reset_tokens', row.id, { used_at: new Date().toISOString() })).catch(() => {})
      throw createError({
        statusCode: 403,
        data: { reason: 'staff_account' },
        message: `This is a staff account, so its password can’t be reset here. Use “Forgot password” on the Directus sign-in at ${useSt8Auth().directusUrl}.`,
      })
    }
    console.error('[st8-auth] password-reset: updateUser failed:', status, code, message)
    throw createError({ statusCode: 502, message: 'We couldn’t set your password. Please try again.' })
  }

  // Burn the token (and any others still open for this user). Best-effort: the password has already changed.
  const open = await directus
    .request(readItems('password_reset_tokens', { fields: ['id'], filter: { user: { _eq: userId }, used_at: { _null: true } }, limit: -1 }))
    .catch(() => [{ id: row.id }])
  const now = new Date().toISOString()
  for (const t of open) {
    await directus.request(updateItem('password_reset_tokens', t.id, { used_at: now })).catch((err) => console.warn('[st8-auth] could not burn reset token:', directusError(err).message ?? err))
  }
  return { ok: true, app: row.app ?? null }
})
