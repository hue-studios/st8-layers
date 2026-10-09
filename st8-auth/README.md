# layers/st8-auth

The shared ST8 login: a sealed `nuxt-auth-utils` session over Directus users, built here so Summit and Portal can
`extends` it later (docs/go-live-plan.md §3, "Packaging for reuse").

**Phase 1 (now):** registers `nuxt-auth-utils` and its session config, types the session user
(`shared/types/auth.d.ts`), and holds the `/login` page shell.

**Phase 2:** ports CardDesk's auth here: `server/utils/auth.ts` (`getValidToken`, `getUserClient`,
`getCurrentUserId`), `server/utils/app-access.ts` (`ensureAppAccess`, `syncAccess`), `server/api/auth/*`,
`app/composables/useAuth.ts`, the global `app/middleware/auth.global.ts` and the auth pages.

**Contract with the host app:** the layer calls `getDirectus()` / `getUserDirectus(token)` from the host's
`server/utils/directus.ts`, and renders inside the host's `auth` layout. When the layer is extracted, those move
with it or become documented requirements.
