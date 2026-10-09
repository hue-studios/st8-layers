# layers/st8-auth

The shared ST8 login: a sealed `nuxt-auth-utils` session over Directus users, built here so Summit and Portal can
`extends` it later (docs/go-live-plan.md §3, "Packaging for reuse"). Nothing in it is Insider-specific; the host
names the app in runtime config.

## What's in it

| Path | What it does |
|---|---|
| `server/utils/auth.ts` | `getValidToken` (refresh single-flight, sliding 30-day window, keeps a still-valid token when a refresh fails, 401 only when Directus rejects the refresh token), `getUserClient`, `getCurrentUserId` (from the session, no `/users/me`), `getSessionMembership`, `startSession` / `endSession`, `revalidateSession` |
| `server/utils/app-access.ts` | `ensureAppAccess(userId, app)` (open signup: creates the membership, then syncs), `syncAccess(userId)` (memberships → `app_role_policies` → `directus_access`), `readMembership` |
| `server/utils/profile.ts` | `fetchProfile` (`directus_users` + `profiles` with `industry.name/color`), `fetchSessionUser`, `ensureProfile` |
| `server/utils/sign-in.ts` | `completeSignIn`: suspended check → `ensureAppAccess` → `ensureProfile` → session |
| `server/utils/users.ts` | `findUserByEmail` (case-insensitive; some legacy emails are mixed-case) |
| `server/utils/rate-limit.ts` | `enforceRateLimit` (fixed window in the `st8-auth-rate-limit` storage mount) |
| `server/utils/email-send.ts`, `emails/` | SendGrid v3 REST sender (no SDK) and the password-reset, welcome and invite templates |
| `server/api/auth/*` | `login`, `register`, `logout`, `refresh`, `heartbeat`, `password-request`, `password-reset`, `accept-invite`, `sync-access` |
| `server/api/websocket/token.get.ts` | The access token for the realtime handshake (see "Tokens" below) |
| `server/dev/session.ts` | Dev-only `/api/auth/dev/session`: inspect the session, simulate an expired token. Not in production builds. |
| `app/middleware/auth.global.ts` | Every route needs a session except `publicRoutes` and pages with `definePageMeta({ auth: false })` |
| `app/composables/useAuth.ts` | `login`, `register`, `requestPasswordReset`, `resetPassword`, `acceptInvite`, `logout`, plus `authError()` |
| `app/plugins/session-resume.client.ts` | Pings the heartbeat when the app returns to the foreground |
| `app/pages/` | `/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/accept-invite` |
| `app/components/auth/` | The forms (`AuthLoginForm`, `AuthRegisterForm`, `AuthForgotPasswordForm`, `AuthNewPasswordForm`) and their pieces |
| `shared/types/auth.d.ts` | The typed session (`#auth-utils` augmentation) |

## Contract with the host app

The layer expects the host to provide:

- **`getDirectus()` and `getUserDirectus(token)`** as Nitro server utils (Insider: `server/utils/directus.ts`).
  `getDirectus()` is a scoped service account that can, at minimum: read `directus_users` (`id`, `email`,
  `first_name`, `last_name`, `avatar`, `title`, `status`, `role`); create users with `role`/`status` as presets
  (never writable fields); update `password` and the name/avatar fields; CRUD `memberships`, `profiles`,
  `password_reset_tokens`; read `app_role_policies`, `industries`; read `directus_access`, and create/delete user-level
  rows for the mapped policies only. Insider's `Insider Server` policy (`scripts/directus/access.mjs`) is the
  reference.
- **Runtime config:**

  ```ts
  runtimeConfig: {
    st8Auth: {
      app: 'insider',            // required: insider | summit | portal
      apps: { insider: '' },     // apps a reset link may open (app → origin; '' = this app's APP_URL)
    },
    public: {
      appUrl: '…',               // this app's public origin
      directusUrl: '…',
      st8Auth: { appName: 'Industry Insider' },
    },
  }
  ```

  Optional: `st8Auth.syncSecret` (or env `ST8_ACCESS_SYNC_SECRET`; unset = `/api/auth/sync-access` is off),
  `st8Auth.sendgrid*` (or env `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, `SENDGRID_REPLY_TO`;
  no key = emails are a logged no-op), `public.st8Auth.brandColor`, `public.st8Auth.publicRoutes`.
- **An `auth` layout** the pages render in, the shadcn-vue base components (`~/components/ui/{alert,button,field,input}`),
  the `cn` util, and the `eyebrow` / `glass` / `border-glass-border` theme utilities.
- **Tailwind sources:** the host's CSS must `@source` the layer directory (Insider: `app/assets/css/main.css`).
- **Shared storage (production):** mount a shared driver (Upstash, Vercel KV, Redis) on `st8-auth-rate-limit` in
  `nitro.storage`, or the rate limits count per serverless instance.

When the layer is extracted to its own package, these become its documented peer requirements.

## Session

`session.user` (readable in the browser): `{ id, email, first_name, last_name, avatar, profile: { id, headline,
industry: { id, name, color } } | null }`. `session.secure` (server only): `access_token`, `refresh_token`,
`expires_at`, `membership` (this app's `{ app, role, status }`), `checked_at`.

**Tokens:** the refresh token never leaves the server. The one exception to "no tokens in the browser" is
`GET /api/websocket/token`: Directus's realtime handshake needs an access token client-side, so that route returns
the short-lived access token only, to same-origin requests, uncached.

## Access model

Each user has one Directus role and any number of policies. This layer never writes `role` (new accounts get
`ST8 Member` from the service account's create preset). App access is added on top:

1. `memberships` (`user`, `app`, `role`, `status`) says who belongs to which app at what level.
2. `app_role_policies` maps (`app`, `role`) → policies.
3. `syncAccess(userId)` makes the user's **managed** `directus_access` rows (user-level rows whose policy appears in
   `app_role_policies`) equal the union for their active memberships. Role-level rows and rows for unmapped policies
   (Studio, admin, anything else attached by hand) are never touched.

It runs on every sign-in and from `POST /api/auth/sync-access`, which the Directus Flow
`ST8 · Reconcile access on memberships` calls on memberships create/update/delete
(`scripts/directus/memberships-flow.mjs`). A suspended membership blocks sign-in to that app, ends existing sessions
at their next token refresh, and (through the Flow) removes only that app's policies.

Directus resolves policies on each request, so new policies apply to a token that already exists: sign-in doesn't
log in twice the way CardDesk did.
