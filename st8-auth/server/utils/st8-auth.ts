import type { SessionMembership } from '../../shared/types/auth'

export type St8App = SessionMembership['app']

/** h3's event. h3 isn't a direct dependency (Nitro provides it) and its auto-import is value-only, hence the alias. */
export type AuthEvent = Parameters<typeof getRequestIP>[0]
const ST8_APPS: readonly St8App[] = ['insider', 'summit', 'portal']

/** The layer's runtime config, resolved and checked. Throws a 500 if the host never set `st8Auth.app`. */
export function useSt8Auth() {
  const config = useRuntimeConfig()
  const app = config.st8Auth.app as St8App
  if (!ST8_APPS.includes(app)) {
    throw createError({ statusCode: 500, statusMessage: 'runtimeConfig.st8Auth.app must be insider, summit or portal' })
  }
  const appUrl = String(config.public.appUrl || '').replace(/\/$/, '')
  return {
    app,
    appUrl,
    appName: config.public.st8Auth.appName || 'Southern Tier 8',
    directusUrl: String(config.public.directusUrl).replace(/\/$/, ''),
    /** Origin a reset link for `target` should use, or null if `target` isn't whitelisted. */
    appOrigin(target: string): string | null {
      const apps = (config.st8Auth.apps ?? {}) as Record<string, string>
      if (!Object.hasOwn(apps, target)) return null
      return (apps[target] || (target === app ? appUrl : '')).replace(/\/$/, '') || null
    },
  }
}

/** Trimmed, lowercased email, or '' if it doesn't look like one. */
export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : ''
}

export const MIN_PASSWORD_LENGTH = 8

export function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw createError({ statusCode: 400, message: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
  }
  if (password.length > 256) throw createError({ statusCode: 400, message: 'That password is too long.' })
}

export interface DirectusTokens {
  access_token: string
  refresh_token: string
  /** Access token lifetime in ms. */
  expires: number
}

/** A Directus error as $fetch reports it: HTTP status plus the first error's code and message. */
export function directusError(err: unknown): { status: number | undefined, code: string | undefined, message: string | undefined } {
  const e = err as { status?: number, statusCode?: number, response?: { status?: number }, data?: { errors?: { message?: string, extensions?: { code?: string } }[] }, errors?: { message?: string, extensions?: { code?: string } }[] }
  const first = e?.data?.errors?.[0] ?? e?.errors?.[0]
  return {
    status: e?.status ?? e?.statusCode ?? e?.response?.status,
    code: first?.extensions?.code,
    message: first?.message,
  }
}

/** POST to Directus's own /auth or /users endpoints with no token (login, refresh, logout, invite accept). */
export function directusAuthPost<T>(path: string, body: Record<string, unknown>) {
  const { directusUrl } = useSt8Auth()
  return $fetch<T>(directusUrl + path, { method: 'POST', body, retry: 0, timeout: 15_000 })
}

/** Sign in with email + password. Returns null on bad credentials; throws on anything else. */
export async function directusLogin(email: string, password: string): Promise<DirectusTokens | null> {
  try {
    const res = await directusAuthPost<{ data: DirectusTokens }>('/auth/login', { email, password, mode: 'json' })
    return res.data
  } catch (err) {
    const { status, code } = directusError(err)
    if (code === 'INVALID_OTP') {
      throw createError({ statusCode: 401, data: { reason: 'otp' }, message: 'This account uses two-factor sign-in, which this app doesn’t support yet. Sign in to the Directus Studio instead.' })
    }
    // 400 = Directus rejected the payload (e.g. an email its validator dislikes): same answer as a wrong password.
    if (status === 400 || status === 401 || status === 403 || code === 'INVALID_CREDENTIALS' || code === 'USER_SUSPENDED') return null
    throw err
  }
}

/** Revoke a refresh token at Directus. Best-effort. */
export async function directusLogout(refreshToken: string | undefined) {
  if (!refreshToken) return
  await directusAuthPost('/auth/logout', { refresh_token: refreshToken, mode: 'json' }).catch(() => {})
}

/**
 * The claims of a Directus access token. The token came straight from Directus over TLS, so it is read, not verified;
 * only `id` is used.
 */
export function tokenClaims(accessToken: string): { id: string, role: string | null, app_access: boolean, admin_access: boolean } {
  const payload = accessToken.split('.')[1]
  if (!payload) throw createError({ statusCode: 502, message: 'Directus returned an unreadable token' })
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

/** Client IP for rate limits and audit (x-forwarded-for first; Vercel sets it). */
export function clientIp(event: AuthEvent): string {
  return getRequestIP(event, { xForwardedFor: true })?.split(',')[0]?.trim() || 'unknown'
}

