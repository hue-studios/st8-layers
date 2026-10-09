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
  const route = useRoute()

  async function login(email: string, password: string) {
    await $fetch('/api/auth/login', { method: 'POST', body: { email, password } })
    await fetchSession()
    // replace: Back shouldn't return a signed-in member to the sign-in form.
    await navigateTo(safeRedirect(route.query.redirect), { replace: true })
  }

  async function register(data: { email: string, password: string, first_name: string, last_name: string }) {
    try {
      await $fetch('/api/auth/register', { method: 'POST', body: data })
    } catch (err) {
      // The email has an account and the password didn't match: send them to sign in rather than dead-ending here.
      if (authError(err, '').reason === 'account_exists') {
        await navigateTo({ path: '/login', query: { email: data.email, exists: '1' } }, { replace: true })
      }
      throw err
    }
    await fetchSession()
    await navigateTo(safeRedirect(route.query.redirect), { replace: true })
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
      await navigateTo('/', { replace: true })
    } else {
      await navigateTo({ path: '/login', query: { invited: '1' } }, { replace: true })
    }
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    await fetchSession()
    await navigateTo('/login', { replace: true })
  }

  return { user, loggedIn, login, register, requestPasswordReset, resetPassword, acceptInvite, logout }
}
