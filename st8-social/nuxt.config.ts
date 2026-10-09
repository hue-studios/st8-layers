import { fileURLToPath } from 'node:url'

// ST8 social layer: threads, comments, reactions, reports, moderation and notifications, shared by every ST8 app
// (docs/go-live-plan.md §5). It needs layers/st8-auth (session, getUserClient). Everything app-specific is the host's:
// which collections are social targets (registerSocialTarget in a Nitro plugin) and the runtime config below. See
// README.md for the contract.
export default defineNuxtConfig({
  runtimeConfig: {
    st8Social: {
      /** memberships.role values that may hide, remove and lock. */
      moderatorRoles: ['moderator', 'admin'],
      /** An author may edit a comment this long after posting, or any time before someone replies. */
      editWindowMinutes: 15,
      /** Distinct pending reports that hide a comment until a moderator reviews it. */
      autoHideReports: 3,
      /** Per member: [max, window in seconds]. */
      limits: {
        comments: [10, 60],
        reactions: [60, 60],
        reports: [20, 3600],
      },
    },
    public: {
      st8Social: {
        /**
         * Directus realtime endpoint, e.g. wss://manage.so-tier.com/websocket. Empty = derived from public.directusUrl.
         * NUXT_PUBLIC_ST8_SOCIAL_WEBSOCKET_URL sets it.
         */
        websocketUrl: '',
        /** Where a member's name links to; `:id` is their user id. Empty = names don't link. */
        profilePath: '',
      },
    },
  },

  nitro: {
    // Rate-limit counters. Memory is per instance; mount a shared driver (Upstash/Vercel KV/Redis) on
    // 'st8-social-rate-limit' in the host's nitro.storage to count across serverless instances.
    storage: {
      'st8-social-rate-limit': { driver: 'memory' },
    },
  },

  // Local testing only, never registered in production builds: clears the rate-limit counters (scripts/social-probe.mjs).
  $development: {
    serverHandlers: [
      { route: '/api/social/dev/reset-limits', handler: fileURLToPath(new URL('./server/dev/reset-limits.ts', import.meta.url)) },
    ],
  },
})
