/**
 * Accept a Directus user invite (admins invite from the Studio with this app's /auth/accept-invite as the invite URL;
 * Directus adds ?token=). Directus sets the password and activates the account; then we sign the user in to this app,
 * which joins it like any first sign-in.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown, password?: unknown }>(event)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  assertPassword(body?.password)
  const password = body.password as string
  if (!token) throw createError({ statusCode: 400, message: 'This invitation link is invalid or has expired.' })

  await enforceRateLimit(event, `invite:ip:${clientIp(event)}`, 10, 15 * 60)

  try {
    await directusAuthPost('/users/invite/accept', { token, password })
  } catch (err) {
    const { status, code, message } = directusError(err)
    if (code === 'FAILED_VALIDATION') throw createError({ statusCode: 400, message: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
    if (status && status < 500) throw createError({ statusCode: 400, data: { reason: 'invalid_token' }, message: 'This invitation link is invalid, expired or already used.' })
    console.error('[st8-auth] accept-invite failed:', status, code, message)
    throw createError({ statusCode: 502, message: 'We couldn’t accept the invitation. Please try again.' })
  }

  // The invite JWT carries the email Directus just activated. Read it (Directus accepted the token, so it's genuine).
  let email = ''
  try {
    email = normalizeEmail(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).email)
  } catch { /* fall through: the user signs in by hand */ }
  const tokens = email ? await directusLogin(email, password).catch(() => null) : null
  if (!tokens) return { ok: true, signedIn: false }
  const { joined } = await completeSignIn(event, tokens)
  return { ok: true, signedIn: true, joined }
})
