import { createUser } from '@directus/sdk'
import { welcomeEmail } from '../../utils/emails/templates'

const name = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 80) : '')

const accountExists = () =>
  createError({
    statusCode: 409,
    data: { reason: 'account_exists' },
    message: 'You already have a Southern Tier 8 account with this email. Sign in with that password, or reset it.',
  })

/**
 * Create an account, or join this app with an existing one.
 *
 * One Directus user table serves every ST8 app, so the email may already belong to a partner (Studio user), a Summit
 * user or a member of another app. Then the password must prove ownership (it is never reset or overwritten here), and
 * access is granted additively by completeSignIn. That's how partners and Summit users join.
 *
 * New accounts are created with the server token, whose policy presets role = ST8 Member and status = active.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const email = normalizeEmail(body?.email)
  if (!email) throw createError({ statusCode: 400, message: 'Enter a valid email address.' })
  assertPassword(body?.password)
  const password = body.password as string

  await enforceRateLimit(event, `register:ip:${clientIp(event)}`, 10, 60 * 60)
  await enforceRateLimit(event, `register:email:${email}`, 6, 60 * 60)

  const existing = await findUserByEmail(email)
  if (existing) {
    if (existing.status === 'invited') {
      throw createError({
        statusCode: 409,
        data: { reason: 'invited' },
        message: 'You’ve been invited already. Use the link in your invitation email to set your password.',
      })
    }
    const tokens = await directusLogin(email, password)
    if (!tokens) throw accountExists()
    const { user, joined } = await completeSignIn(event, tokens)
    if (joined) await sendEmail({ to: email, emailName: 'welcome', ...welcomeEmail({ firstName: user.first_name, existingAccount: true }) })
    return { ok: true, existing: true, joined }
  }

  const first_name = name(body?.first_name)
  const last_name = name(body?.last_name)
  if (!first_name || !last_name) throw createError({ statusCode: 400, message: 'Enter your first and last name.' })

  try {
    await getDirectus().request(createUser({ email, password, first_name, last_name }))
  } catch (err) {
    const { status, code, message } = directusError(err)
    if (code === 'RECORD_NOT_UNIQUE') throw accountExists()
    if (code === 'FAILED_VALIDATION' || code === 'INVALID_PAYLOAD' || status === 400) {
      const isPassword = /password/i.test(message ?? '')
      throw createError({
        statusCode: 400,
        data: { reason: isPassword ? 'weak_password' : 'invalid' },
        message: isPassword ? `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.` : 'We couldn’t create your account. Check your details and try again.',
      })
    }
    console.error('[st8-auth] register: createUser failed:', status, code, message)
    throw createError({ statusCode: 502, message: 'We couldn’t create your account. Please try again.' })
  }

  const tokens = await directusLogin(email, password)
  if (!tokens) throw createError({ statusCode: 502, message: 'Your account was created, but signing in failed. Try signing in.' })
  const { user, joined } = await completeSignIn(event, tokens)
  await sendEmail({ to: email, emailName: 'welcome', ...welcomeEmail({ firstName: user.first_name, existingAccount: false }) })
  return { ok: true, existing: false, joined }
})
