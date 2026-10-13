// Client side of the ST8 login. Every call goes through /api/auth/*; the browser never sees a Directus token.

interface ApiError {
  statusCode?: number
  data?: { message?: string, data?: { reason?: string } }
}

/** The server's message and reason code from a failed $fetch. */
export function authError(err: unknown, fallback: string) {
  const e = err as ApiError
  return { message: e?.data?.message || fallback, reason: e?.data?.data?.reason, status: e?.statusCode }
}

export function useAuth() {
  const { user, loggedIn, fetch: fetchSession } = useUserSession()
  const nuxtApp = useNuxtApp()
  const route = useRoute()
  const { postJoinPath, defaultAccess } = useRuntimeConfig().public.st8Auth

  /**
   * After sign-in: back to where the member was going, or, if they just joined this app, to the host's post-join page
   * (runtimeConfig.public.st8Auth.postJoinPath, e.g. onboarding) with that destination as its own redirect.
   * replace: Back shouldn't return a signed-in member to the sign-in form.
   */
  function afterSignIn(joined: boolean) {
    const redirect = safeRedirect(route.query.redirect)
    const next = postJoinPath && joined ? { path: safeRedirect(postJoinPath), query: redirect === '/' ? {} : { redirect } } : redirect
    return navigateTo(next, { replace: true })
  }

  async function login(email: string, password: string) {
    const res = await $fetch('/api/auth/login', { method: 'POST', body: { email, password } })
    await fetchSession()
    await afterSignIn(res.joined)
  }

  async function register(data: { email: string, password: string, first_name: string, last_name: string }) {
    let joined: boolean
    try {
      joined = (await $fetch('/api/auth/register', { method: 'POST', body: data })).joined
    } catch (err) {
      // The email has an account and the password didn't match: send them to sign in rather than dead-ending here.
      if (authError(err, '').reason === 'account_exists') {
        await navigateTo({ path: '/login', query: { email: data.email, exists: '1' } }, { replace: true })
      }
      throw err
    }
    await fetchSession()
    await afterSignIn(joined)
  }

  async function requestPasswordReset(email: string) {
    await $fetch('/api/auth/password-request', { method: 'POST', body: { email } })
  }

  async function resetPassword(token: string, password: string) {
    await $fetch('/api/auth/password-reset', { method: 'POST', body: { token, password } })
  }

  async function acceptInvite(token: string, password: string) {
    const res = await $fetch('/api/auth/accept-invite', { method: 'POST', body: { token, password } })
    if (res.signedIn) {
      await fetchSession()
      await afterSignIn('joined' in res && !!res.joined)
    } else {
      await navigateTo({ path: '/login', query: { invited: '1' } }, { replace: true })
    }
  }

  /** Sign out of this app (its Directus refresh token is revoked; other ST8 apps keep their own sessions). */
  async function logout() {
    // Listeners undo what belongs to this browser first (st8-social: the push subscription); never blocks sign-out.
    try {
      await nuxtApp.callHook('st8-auth:sign-out')
    } catch {
      // never blocks sign-out
    }
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    await fetchSession()
    // A public site (defaultAccess 'public') keeps the visitor on the page they were reading, unless it's members-only.
    if (defaultAccess === 'public') {
      if (isMembersOnlyRoute(route)) await navigateTo('/', { replace: true })
      return
    }
    await navigateTo('/login', { replace: true })
  }

  return { user, loggedIn, login, register, requestPasswordReset, resetPassword, acceptInvite, logout }
}
