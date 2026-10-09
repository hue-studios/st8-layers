// Development only: preview the auth emails with sample data. /api/auth/dev/email?name=password-reset|welcome|invite
// (&format=text for the plain-text part).
import { inviteEmail, passwordResetEmail, welcomeEmail } from '../utils/emails/templates'

export default defineEventHandler((event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  const { name, format } = getQuery(event)
  const { appUrl } = useSt8Auth()
  const email
    = name === 'welcome'
      ? welcomeEmail({ firstName: 'Jordan', existingAccount: false })
      : name === 'invite'
        ? inviteEmail({ inviterName: 'Sam Rivera', firstName: 'Jordan', note: 'Great meeting you at the Summit!', inviteUrl: `${appUrl}/i/sample` })
        : passwordResetEmail({ firstName: 'Jordan', resetUrl: `${appUrl}/auth/reset-password?token=sample`, expiresIn: '1 hour' })
  if (format === 'text') {
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return `Subject: ${email.subject}\n\n${email.text}`
  }
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return email.html
})
