// What every successful credential check (login, register, accept-invite) does next.

/**
 * Turn proven credentials into a session for this app:
 * 1. a suspended membership in this app refuses sign-in (403) and revokes the fresh refresh token;
 * 2. ensureAppAccess joins the app if needed (open signup) and reconciles policies, additively, never touching role;
 * 3. the global profile row is created if missing (new signups, and partners or Summit users joining);
 * 4. the session is sealed with the tokens in `secure`.
 *
 * Directus resolves policies per request, so the new policies apply to the token we already hold: no re-login.
 */
export async function completeSignIn(event: AuthEvent, tokens: DirectusTokens) {
  const { app, appName } = useSt8Auth()
  const { id: userId } = tokenClaims(tokens.access_token)

  const current = await readMembership(userId, app)
  if (current?.status === 'suspended') {
    await directusLogout(tokens.refresh_token)
    throw createError({ statusCode: 403, data: { reason: 'suspended' }, message: `Your ${appName} membership is suspended. Contact Southern Tier 8 if you think this is a mistake.` })
  }

  const { membership, joined } = await ensureAppAccess(userId, app)
  await ensureProfile(userId).catch((err) => console.error('[st8-auth] ensureProfile failed:', directusError(err).message ?? err))
  const user = await startSession(event, userId, tokens, membership)
  return { user, joined }
}
