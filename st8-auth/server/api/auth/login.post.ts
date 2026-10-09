import { welcomeEmail } from '../../utils/emails/templates'

// Sign in with email + password. A first sign-in to this app joins it (open signup): see completeSignIn.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown, password?: unknown }>(event)
  const email = normalizeEmail(body?.email)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) throw createError({ statusCode: 400, message: 'Enter your email and password.' })

  await enforceRateLimit(event, `login:ip:${clientIp(event)}`, 20, 15 * 60)
  await enforceRateLimit(event, `login:email:${email}`, 8, 15 * 60)

  const tokens = await directusLogin(email, password)
  if (!tokens) throw createError({ statusCode: 401, message: 'That email and password don’t match.' })

  const { user, joined } = await completeSignIn(event, tokens)
  // A partner or another app's member joining by signing in gets the same welcome as one who registers.
  if (joined) await sendEmail({ to: email, emailName: 'welcome', ...welcomeEmail({ firstName: user.first_name, existingAccount: true }) })
  return { ok: true, joined }
})
