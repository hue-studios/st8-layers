// Transactional email through SendGrid's v3 REST API (no SDK dependency). Best-effort by design: it never throws, so a
// mail outage can't break sign-up or a reset request. Without an API key it logs and does nothing.

export interface SendArgs {
  to: string
  subject: string
  html: string
  text: string
  /** Email kind, e.g. 'password-reset'. Becomes a SendGrid category. */
  emailName: string
  /** Logged instead of sent when there's no API key, in development only (e.g. the reset link). */
  devPreview?: string
}

export interface SendResult {
  sent: boolean
  reason?: string
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const config = useRuntimeConfig()
  const { app, appName } = useSt8Auth()
  const apiKey = config.st8Auth.sendgridApiKey || process.env.SENDGRID_API_KEY
  const fromEmail = config.st8Auth.sendgridFromEmail || process.env.SENDGRID_FROM_EMAIL || 'mail@so-tier.com'
  const fromName = config.st8Auth.sendgridFromName || process.env.SENDGRID_FROM_NAME || appName
  const replyTo = config.st8Auth.sendgridReplyTo || process.env.SENDGRID_REPLY_TO || ''

  if (!apiKey) {
    console.info(`[st8-auth] email "${args.emailName}" not sent (no SENDGRID_API_KEY)`)
    if (import.meta.dev && args.devPreview) console.info(`[st8-auth] dev preview: ${args.devPreview}`)
    return { sent: false, reason: 'no api key' }
  }

  try {
    await $fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        personalizations: [{ to: [{ email: args.to }] }],
        from: { email: fromEmail, name: fromName },
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        subject: args.subject,
        content: [
          { type: 'text/plain', value: args.text },
          { type: 'text/html', value: args.html },
        ],
        categories: [app, args.emailName],
        // Transactional: no click/open tracking rewriting the reset link.
        tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
      },
      retry: 1,
      timeout: 15_000,
    })
    return { sent: true }
  } catch (err) {
    const e = err as { data?: { errors?: { message?: string }[] }, message?: string }
    const reason = e?.data?.errors?.[0]?.message || e?.message || 'send failed'
    console.warn(`[st8-auth] email "${args.emailName}" failed:`, reason)
    return { sent: false, reason }
  }
}
