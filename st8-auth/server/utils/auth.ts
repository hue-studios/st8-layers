import type { SecureSessionData, User, UserSession } from '#auth-utils'

// Session + Directus token handling, ported from CardDesk's server/utils/auth.ts (docs/go-live-plan.md §3).
// Differences: tokens live in session.secure (never sent to the browser), the user id is in the session (no
// /users/me per request), and a token refresh also re-reads the app membership so a suspension ends the session.

const REFRESH_EARLY_MS = 60_000 // refresh when less than a minute is left
const SLIDE_THROTTLE_MS = 24 * 60 * 60 * 1000 // slide the session window at most once a day
const RECHECK_MS = 5 * 60 * 1000 // re-read membership + user at most every 5 minutes (heartbeat)

/**
 * In-process single-flight for token refresh, keyed by the refresh token. Directus rotates refresh tokens in `json`
 * mode (each is single-use), so concurrent requests inside the refresh window would otherwise all POST /auth/refresh
 * with the same token: the first wins and the rest 401. Coalescing them gives everyone the first result.
 */
const refreshInFlight = new Map<string, Promise<DirectusTokens>>()

function refreshTokens(refreshToken: string): Promise<DirectusTokens> {
  let inflight = refreshInFlight.get(refreshToken)
  if (!inflight) {
    inflight = directusAuthPost<{ data: DirectusTokens }>('/auth/refresh', { refresh_token: refreshToken, mode: 'json' })
      .then((res) => res.data)
      .finally(() => refreshInFlight.delete(refreshToken))
    refreshInFlight.set(refreshToken, inflight)
  }
  return inflight
}

/**
 * Sliding-session renewal. h3 anchors the sealed cookie's expiry to the session's `createdAt` and never moves it on
 * updates, so `maxAge` would otherwise be a fixed window from sign-in. Resetting `createdAt` on the in-context session
 * (throttled) makes the next setUserSession re-seal with `expires = now + maxAge`. Returns true if it moved.
 */
function slideSessionAnchor(event: AuthEvent): boolean {
  const name = useRuntimeConfig().session.name || 'nuxt-session'
  const raw = (event.context as { sessions?: Record<string, { createdAt?: number }> }).sessions?.[name]
  if (!raw?.createdAt || Date.now() - raw.createdAt < SLIDE_THROTTLE_MS) return false
  raw.createdAt = Date.now()
  return true
}

/**
 * Replace top-level session fields in place. nuxt-auth-utils' setUserSession merges with defu, which skips nulls (a
 * removed avatar would stick) and concatenates arrays; replaceUserSession re-reads the request cookie, losing a slid
 * createdAt. This updates the already-loaded h3 session with the same config nuxt-auth-utils uses.
 */
async function patchSession(event: AuthEvent, patch: { user?: User, secure?: SecureSessionData }) {
  const config = useRuntimeConfig(event)
  const password = process.env[`${config.nitro?.envPrefix || 'NUXT_'}SESSION_PASSWORD`] || config.session.password
  const session = await useSession(event, { ...config.session, password } as Parameters<typeof useSession>[1])
  await session.update(patch)
}

/** The session with its secure part, or a 401. */
async function requireSecureSession(event: AuthEvent): Promise<UserSession & { user: NonNullable<UserSession['user']>, secure: SecureSessionData }> {
  const session = await getUserSession(event)
  if (!session.user?.id || !session.secure?.access_token) {
    throw createError({ statusCode: 401, message: 'Not signed in' })
  }
  return session as UserSession & { user: NonNullable<UserSession['user']>, secure: SecureSessionData }
}

/** Seal a fresh session after sign-in. Replaces whatever was there. */
export async function startSession(event: AuthEvent, userId: string, tokens: DirectusTokens, membership: SecureSessionData['membership']) {
  const user = await fetchSessionUser(userId)
  await replaceUserSession(event, {
    user,
    secure: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires ?? 900_000),
      membership,
      checked_at: Date.now(),
    },
    loggedInAt: Date.now(),
  })
  return user
}

/** End the session and revoke its Directus refresh token. */
export async function endSession(event: AuthEvent) {
  const session = await getUserSession(event)
  await directusLogout(session.secure?.refresh_token)
  await clearUserSession(event)
}

/** Re-read the app membership; a suspended one ends the session (401). Returns the membership. */
async function assertMembership(event: AuthEvent, userId: string) {
  const { app, appName } = useSt8Auth()
  const membership = await readMembership(userId, app)
  if (membership?.status === 'suspended') {
    await endSession(event)
    throw createError({ statusCode: 401, data: { reason: 'suspended' }, message: `Your ${appName} membership is suspended.` })
  }
  return membership
}

/**
 * A valid Directus access token for the signed-in user, refreshing it when it's about to expire. Throws 401 when there
 * is no session or Directus rejects the refresh token, 503 when the refresh fails transiently (the session is kept).
 */
export async function getValidToken(event: AuthEvent, opts: { force?: boolean } = {}): Promise<string> {
  const session = await requireSecureSession(event)
  const { access_token, refresh_token, expires_at } = session.secure

  const slid = slideSessionAnchor(event)
  if (!opts.force && expires_at - Date.now() > REFRESH_EARLY_MS) {
    // Re-seal only if the anchor moved, so the later cookie expiry reaches the browser.
    if (slid) await patchSession(event, {})
    return access_token
  }

  let fresh: DirectusTokens
  try {
    fresh = await refreshTokens(refresh_token)
  } catch (err) {
    // The rotation race across instances (the loser 401s while its access token is still good) or a blip: keep using
    // the current token while it lasts. Clearing the session here was CardDesk's "logged out regularly" bug.
    if (expires_at > Date.now()) {
      console.warn('[st8-auth] token refresh failed, access token still valid; continuing:', directusError(err).message ?? err)
      return access_token
    }
    const { status } = directusError(err)
    if (status === 401 || status === 403) {
      await clearUserSession(event)
      throw createError({ statusCode: 401, message: 'Your session expired. Please sign in again.' })
    }
    console.error('[st8-auth] token refresh failed transiently; keeping session:', directusError(err).message ?? err)
    throw createError({ statusCode: 503, message: 'Sign-in service temporarily unavailable. Please retry.' })
  }

  const membership = await assertMembership(event, session.user.id)
  await patchSession(event, {
    secure: {
      ...session.secure,
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: Date.now() + (fresh.expires ?? 900_000),
      membership,
      checked_at: Date.now(),
    },
  })
  return fresh.access_token
}

/**
 * Heartbeat work: a valid token, plus (at most every few minutes) a fresh read of the membership and the session user,
 * so a suspension, a new avatar or a profile change reaches the session without signing in again.
 */
export async function revalidateSession(event: AuthEvent) {
  await getValidToken(event)
  const session = await requireSecureSession(event)
  if (Date.now() - (session.secure.checked_at ?? 0) < RECHECK_MS) return session.user
  const membership = await assertMembership(event, session.user.id)
  const user = await fetchSessionUser(session.user.id)
  await patchSession(event, { user, secure: { ...session.secure, membership, checked_at: Date.now() } })
  return user
}

/**
 * Re-read the session user (names, avatar, profile summary) right away, after the host app changed one of them, so the
 * shell shows the change without waiting for the heartbeat. The client then calls useUserSession().fetch().
 */
export async function refreshSessionUser(event: AuthEvent) {
  const session = await requireSecureSession(event)
  const user = await fetchSessionUser(session.user.id)
  await patchSession(event, { user })
  return user
}

/** The signed-in user's Directus id, from the session (no Directus round trip). Throws 401. */
export async function getCurrentUserId(event: AuthEvent): Promise<string> {
  const session = await requireSecureSession(event)
  return session.user.id
}

/**
 * A Directus client bound to the member's own access token, for the reads and writes they make themselves, so Directus
 * applies their policies and attributes the activity to them. System work keeps using getDirectus().
 */
export async function getUserClient(event: AuthEvent): Promise<{ me: string, directus: ReturnType<typeof getUserDirectus> }> {
  const token = await getValidToken(event)
  return { me: await getCurrentUserId(event), directus: getUserDirectus(token) }
}

/** The signed-in user's app membership from the session (re-read on refresh and heartbeat). */
export async function getSessionMembership(event: AuthEvent) {
  const session = await requireSecureSession(event)
  return session.secure.membership
}
