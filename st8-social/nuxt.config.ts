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
      /** Cross-app teasers: an app's activity on a target shows only from this many people (after blocks). */
      teaserThreshold: 3,
      /** How long a member's blocks are memoised per instance (a block made here clears them at once). 0 = always read. */
      blockMemoSeconds: 5,
      /**
       * Which pending reports count toward autoHideReports (every report still reaches the queue): reporters who joined
       * at least memberHours ago, and whose last historyDays aren't mostly dismissed reports (unreliableDismissed or
       * more dismissed, under unreliableActionedRatio of their reviewed reports actioned).
       */
      autoHide: { memberHours: 24, historyDays: 90, unreliableDismissed: 5, unreliableActionedRatio: 0.2 },
      /** Per member: [max, window in seconds]. moderation = a moderator's actions, suspensions = theirs per day. */
      limits: {
        comments: [10, 60],
        reactions: [60, 60],
        reports: [20, 3600],
        reportsDaily: [50, 86400],
        moderation: [120, 3600],
        suspensions: [20, 86400],
        teasers: [60, 60],
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
        /**
         * Cross-app teasers: the other apps whose activity on a shared row this app shows (SocialTeaserApp: app, label,
         * joinUrl, openUrl?). Empty = none.
         */
        teasers: [] as { app: string, label: string, joinUrl: string, openUrl?: string }[],
        /** The host's moderation queue page (SocialModerationQueue); moderators' notifications link to it. */
        moderationPath: '/moderation',
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
