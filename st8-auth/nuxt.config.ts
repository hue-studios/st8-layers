import { fileURLToPath } from 'node:url'

// ST8 auth layer: sealed nuxt-auth-utils session over Directus, shared by every ST8 app (docs/go-live-plan.md §3).
// Everything app-specific (which app this is, its name, the apps a reset link may return to) is runtime config the
// host sets; see README.md for the contract.
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils'],

  runtimeConfig: {
    // NUXT_SESSION_PASSWORD (32+ characters) seals the cookie.
    // maxAge is the absolute window; getValidToken slides it on activity (server/utils/auth.ts).
    session: {
      maxAge: 60 * 60 * 24 * 30,
      cookie: { sameSite: 'lax' },
    },
    st8Auth: {
      /** The ST8 app this server is: 'insider' | 'summit' | 'portal'. Required; the host sets it. */
      app: '',
      /**
       * Apps a password-reset link may return to (app → origin). An empty origin means this app's own
       * public.appUrl. Only apps listed here are accepted by POST /api/auth/password-request.
       */
      apps: {} as Record<string, string>,
      /**
       * Collections another ST8 app's join link may name in `?via=<app>:<collection>:<item>` (its cross-app teasers);
       * recorded on the new membership as `joined_via`. Empty = `via` is ignored.
       */
      joinViaCollections: ['events'] as string[],
      /** Time zone for dates shown to members (a suspension's end). */
      timeZone: 'America/New_York',
      /** Shared secret for POST /api/auth/sync-access (the Directus memberships Flow). Unset = endpoint disabled. */
      syncSecret: '',
      /** Transactional email. Unset key = sending is a logged no-op. SENDGRID_* env vars also work. */
      sendgridApiKey: '',
      sendgridFromEmail: '',
      sendgridFromName: '',
      sendgridReplyTo: '',
    },
    public: {
      st8Auth: {
        /** Display name used in auth pages and emails, e.g. "Industry Insider". */
        appName: '',
        /** Hex brand colour for emails. */
        brandColor: '#00efd1',
        /**
         * Routes that don't need a session (prefix match on '/'-terminated entries). Pages can also opt out with
         * definePageMeta({ auth: false }).
         */
        publicRoutes: ['/login', '/auth/', '/i/'],
        /**
         * Where a member lands right after joining this app (a new signup, a first sign-in, an accepted invite), e.g.
         * the host's onboarding page. It gets `?redirect=<where they were going>`. Empty = straight to that redirect.
         */
        postJoinPath: '',
      },
    },
  },

  nitro: {
    // Rate-limit counters. Memory is per instance; mount a shared driver (Upstash/Vercel KV/Redis) on
    // 'st8-auth-rate-limit' in the host's nitro.storage to count across serverless instances.
    storage: {
      'st8-auth-rate-limit': { driver: 'memory' },
    },
  },

  // Local testing only, never registered in production builds: /api/auth/dev/session inspects the session and
  // simulates an expired access token (test refresh without waiting out the Directus TTL); /api/auth/dev/email
  // previews the auth emails.
  $development: {
    serverHandlers: [
      { route: '/api/auth/dev/session', handler: fileURLToPath(new URL('./server/dev/session.ts', import.meta.url)) },
      { route: '/api/auth/dev/email', handler: fileURLToPath(new URL('./server/dev/email.ts', import.meta.url)) },
    ],
  },
})
