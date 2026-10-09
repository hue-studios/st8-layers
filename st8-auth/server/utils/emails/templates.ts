import { renderEmail, type RenderedEmail } from './shell'

// Copy for the auth emails. App names and URLs come from runtime config, so the same templates serve every ST8 app.

type Email = { subject: string } & RenderedEmail

const hello = (firstName?: string | null) => (firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,')

export function passwordResetEmail(args: { firstName?: string | null, resetUrl: string, expiresIn: string }): Email {
  const { appName } = useSt8Auth()
  return {
    subject: 'Reset your Southern Tier 8 password',
    ...renderEmail({
      preheader: `Choose a new password. The link expires in ${args.expiresIn}.`,
      heading: 'Reset your password',
      paragraphs: [
        hello(args.firstName),
        `We got a request to reset the password for your Southern Tier 8 account, which you use to sign in to ${appName}. Choose a new one with the button below.`,
        `The link expires in ${args.expiresIn} and works once.`,
      ],
      cta: { label: 'Choose a new password', url: args.resetUrl },
      footnote: 'If you didn’t ask for this, ignore this email. Your password stays the same.',
    }),
  }
}

export function welcomeEmail(args: { firstName?: string | null, existingAccount: boolean }): Email {
  const { appName, appUrl } = useSt8Auth()
  return {
    subject: `Welcome to ${appName}`,
    ...renderEmail({
      preheader: `You’re in. Your ${appName} membership is ready.`,
      heading: `Welcome to ${appName}`,
      paragraphs: [
        hello(args.firstName),
        args.existingAccount
          ? `You’ve joined ${appName} with your existing Southern Tier 8 account. Sign in with the same email and password you already use.`
          : `Your Southern Tier 8 account is ready, and you’re now a member of ${appName}.`,
        'Add your industry, counties and a short bio to your profile so other members can find you.',
      ],
      cta: { label: `Open ${appName}`, url: appUrl },
      footnote: 'If you didn’t create this account, let Southern Tier 8 know at so-tier.com.',
    }),
  }
}

/** A member invites someone to join. Phase 5 (invites) sends it; the copy lives here with the other auth emails. */
export function inviteEmail(args: { inviterName: string, firstName?: string | null, note?: string | null, inviteUrl: string }): Email {
  const { appName } = useSt8Auth()
  return {
    subject: `${args.inviterName} invited you to ${appName}`,
    ...renderEmail({
      preheader: `${args.inviterName} wants to connect with you on ${appName}.`,
      heading: `Join ${args.inviterName} on ${appName}`,
      paragraphs: [
        hello(args.firstName),
        `${args.inviterName} invited you to join them on ${appName}, part of the Southern Tier 8 network.`,
        ...(args.note?.trim() ? [`“${args.note.trim()}”`] : []),
      ],
      cta: { label: 'Accept the invite', url: args.inviteUrl },
      footnote: 'If you weren’t expecting this, you can ignore it.',
    }),
  }
}
