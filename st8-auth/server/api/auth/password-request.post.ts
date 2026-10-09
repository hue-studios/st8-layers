import { randomBytes } from 'node:crypto'
import { createItem } from '@directus/sdk'
import { passwordResetEmail } from '../../utils/emails/templates'

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Start a password reset (the Earnest/CardDesk flow): mint a single-use token in `password_reset_tokens` and email a
 * branded link instead of Directus's own unstyled one. `app` picks which app's reset page the link opens; only apps in
 * runtimeConfig.st8Auth.apps are accepted. Always answers { ok: true } for a valid request, whether or not the email
 * has an account, so it can't be used to discover accounts.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown, app?: unknown }>(event)
  const st8 = useSt8Auth()
  const email = normalizeEmail(body?.email)
  if (!email) throw createError({ statusCode: 400, message: 'Enter a valid email address.' })
  const target = (typeof body?.app === 'string' && body.app) || st8.app
  const origin = st8.appOrigin(target)
  if (!origin) throw createError({ statusCode: 400, message: 'Unknown app.' })

  await enforceRateLimit(event, `reset-request:ip:${clientIp(event)}`, 10, 15 * 60)
  await enforceRateLimit(event, `reset-request:email:${email}`, 3, 15 * 60)

  try {
    const user = await findUserByEmail(email)
    // Invited and suspended accounts can't sign in with a password, so a reset would only confuse them.
    if (!user || user.status !== 'active') return { ok: true }

    const token = randomBytes(32).toString('hex')
    await getDirectus().request(
      createItem('password_reset_tokens', {
        user: user.id,
        token,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
        requested_ip: clientIp(event),
        app: target as St8App,
      }),
    )
    const resetUrl = `${origin}/auth/reset-password?token=${token}`
    await sendEmail({
      to: user.email,
      emailName: 'password-reset',
      devPreview: resetUrl,
      ...passwordResetEmail({ firstName: user.first_name, resetUrl, expiresIn: '1 hour' }),
    })
  } catch (err) {
    console.error('[st8-auth] password-request failed:', directusError(err).message ?? err)
  }
  return { ok: true }
})
