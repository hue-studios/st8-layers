// ST8 auth layer: sealed nuxt-auth-utils session over Directus, shared by every ST8 app (docs/go-live-plan.md §3).
// Phase 1 only registers the session module and its config; the auth routes, composables and pages arrive in Phase 2.
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils'],

  runtimeConfig: {
    // NUXT_SESSION_PASSWORD (32+ characters) seals the cookie.
    // maxAge is the absolute window; Phase 2's getValidToken slides it, as in CardDesk.
    session: {
      maxAge: 60 * 60 * 24 * 30,
      cookie: { sameSite: 'lax' },
    },
  },
})
