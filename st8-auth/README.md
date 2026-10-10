# layers/st8-auth

The shared ST8 login: a sealed `nuxt-auth-utils` session over Directus users, built here so Summit and Portal can
`extends` it later (docs/go-live-plan.md §3, "Packaging for reuse"). Nothing in it is Insider-specific; the host
names the app in runtime config.

## What's in it

| Path | What it does |
|---|---|
| `server/utils/auth.ts` | `getValidToken` (refresh single-flight, a just-rotated refresh token answered from memory for a minute, sliding 30-day window, keeps a still-valid token when a refresh fails, 401 only when Directus rejects the refresh token), `getUserClient` (re-checks the membership when Directus refuses the member), `getCurrentUserId` (from the session, no `/users/me`), `getSessionMembership` (re-read on every write and every 30 s; see "Suspension"), `startSession` / `endSession`, `revalidateSession`, `refreshSessionUser`, `suspendedMessage` |
| `server/utils/app-access.ts` | `ensureAppAccess(userId, app)` (open signup: creates the membership, then syncs), `syncAccess(userId)` (memberships → `app_role_policies` → `directus_access`), `readMembership`, `currentMembership` (lifts a suspension that has run out), `suspendMembership` / `restoreMembership`, `onMembershipChange` |
| `server/middleware/st8-membership.ts` | Every `/api` request with a session (not `/api/auth/*`) re-checks the membership through `getSessionMembership` |
| `server/utils/profile.ts` | `fetchProfile` (`directus_users` + `profiles` with `industry.name/color`), `fetchSessionUser`, `ensureProfile` |
| `server/utils/sign-in.ts` | `completeSignIn`: suspended check → `ensureAppAccess` → `ensureProfile` → session |
| `server/utils/users.ts` | `findUserByEmail` (case-insensitive; some legacy emails are mixed-case) |
| `server/utils/rate-limit.ts` | `enforceRateLimit` (fixed window in the `st8-auth-rate-limit` storage mount) |
| `server/utils/join-via.ts` | `parseJoinVia`, `takeJoinVia`: where a new member came from (`memberships.joined_via`, below) |
| `server/utils/email-send.ts`, `emails/` | SendGrid v3 REST sender (no SDK) and the password-reset, welcome and invite templates |
| `server/api/auth/*` | `login`, `register`, `logout`, `refresh`, `heartbeat`, `password-request`, `password-reset`, `accept-invite`, `sync-access` |
| `server/api/websocket/token.get.ts` | The access token for the realtime handshake (see "Tokens" below) |
| `server/dev/session.ts` | Dev-only `/api/auth/dev/session`: inspect the session, simulate an expired token. Not in production builds. |
| `app/middleware/auth.global.ts` | Every route needs a session except `publicRoutes` and pages with `definePageMeta({ auth: false })` |
| `app/composables/useAuth.ts` | `login`, `register`, `requestPasswordReset`, `resetPassword`, `acceptInvite`, `logout`, plus `authError()` |
| `app/plugins/session-resume.client.ts` | Pings the heartbeat when the app returns to the foreground, and every 2 minutes while it's in view |
| `app/plugins/session-guard.client.ts` | Wraps the global `$fetch`: any `/api` 401 (outside `/api/auth/*`) means the session ended; go to sign-in (`?suspended=1` for a suspension) |
| `app/composables/useSessionEnded.ts` | What both plugins do on a 401: re-read the session, then `/login?redirect=…` |
| `app/plugins/st8-join-via.client.ts` | Keeps another app's `?via=` for a day (cookie `st8_via`) so sign-up or sign-in can record it |
| `app/pages/` | `/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/accept-invite` |
| `app/components/auth/` | The forms (`AuthLoginForm`, `AuthRegisterForm`, `AuthForgotPasswordForm`, `AuthNewPasswordForm`) and their pieces |
| `shared/types/auth.d.ts` | The typed session (`#auth-utils` augmentation) |

## Contract with the host app

The layer expects the host to provide:

- **`getDirectus()` and `getUserDirectus(token)`** as Nitro server utils (Insider: `server/utils/directus.ts`).
  `getDirectus()` is a scoped service account that can, at minimum: read `directus_users` (`id`, `email`,
  `first_name`, `last_name`, `avatar`, `title`, `status`, `role`); create users with `role`/`status` as presets
  (never writable fields); update `password` and the name/avatar fields, but not on administrators or role-less
  service accounts (those reset through Directus; the reset route says so); CRUD `memberships` (including `status`,
  `suspended_until`, `suspended_reason`, which suspension writes), `profiles`, `password_reset_tokens`; read `app_role_policies`, `industries`; read `directus_access`, and create/delete user-level
  rows for the mapped policies only. Insider's `Insider Server` policy (`scripts/directus/access.mjs`) is the
  reference.
- **Runtime config:**

  ```ts
  runtimeConfig: {
    st8Auth: {
      app: 'insider',            // required: insider | summit | portal
      apps: { insider: '' },     // apps a reset link may open (app → origin; '' = this app's APP_URL)
      joinViaCollections: ['events'], // collections another app's join link may name in ?via= (the default)
      timeZone: 'America/New_York',     // dates shown to members (a suspension's end); the default
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
  no key = emails are a logged no-op), `public.st8Auth.brandColor`, `public.st8Auth.publicRoutes`, `public.st8Auth.postJoinPath` (see "Hooks" below).
- **An `auth` layout** the pages render in, the shadcn-vue base components (`~/components/ui/{alert,button,field,input}`),
  the `cn` util, and the `eyebrow` / `glass` / `border-glass-border` theme utilities.
- **Tailwind sources:** the host's CSS must `@source` the layer directory (Insider: `app/assets/css/main.css`).
- **Shared storage (production):** mount a shared driver (Upstash, Vercel KV, Redis) on `st8-auth-rate-limit` in
  `nitro.storage`, or the rate limits count per serverless instance.

When the layer is extracted to its own package, these become its documented peer requirements.

## Hooks for the host

- **`public.st8Auth.postJoinPath`**: where a member lands right after **joining** this app (a new signup, a first
  sign-in by a partner or another app's member, an accepted invite), e.g. an onboarding page. It gets
  `?redirect=<where they were going>` (omitted when that's `/`) and is responsible for sending them on. Later
  sign-ins go straight to the redirect. Empty (the default) = no detour. Insider: `/onboarding`.
- **`refreshSessionUser(event)`** (server util): after the host changes a user's names, avatar or profile, call it so
  `session.user` is re-read at once instead of at the next heartbeat; then `useUserSession().fetch()` on the client.

## Session

`session.user` (readable in the browser): `{ id, email, first_name, last_name, avatar, profile: { id, headline,
industry: { id, name, color } } | null }`. `session.secure` (server only): `access_token`, `refresh_token`,
`expires_at`, `membership` (this app's `{ app, role, status, until }`), `checked_at`. The 30 s membership re-check is remembered per server instance, not in the cookie.

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
(`scripts/directus/memberships-flow.mjs`). The Flow also sends `x-st8-actor` (`{{$accountability.user}}`), so a
`status` change made by anyone but this app's server account (an admin in the Studio) reaches `onMembershipChange`
listeners with `source: 'studio'`. A suspended membership is described under "Suspension" below.

Directus resolves policies on each request, so new policies apply to a token that already exists: sign-in doesn't
log in twice the way CardDesk did.

## Suspension

A suspension is per app: `memberships.status = suspended`, with `suspended_until` (null = until restored) and an
internal `suspended_reason` (members' own read of `memberships` never includes either). `suspendMembership(userId, app,
{ until, reason, by })` and `restoreMembership(userId, app, { by })` write the row and run `syncAccess` at once (not
waiting for the Flow), so only that app's policies go, straight away. Nothing else changes: not `role`, not
`directus_users.status`, not other apps' memberships or the Studio, and the member's Directus refresh tokens aren't
revoked (their other apps keep working).

- **Sign-in** refuses it (403, `data: { reason: 'suspended', until }`, "suspended until Nov 1, 2026") and revokes the
  fresh refresh token.
- **Live sessions** end at the member's next write (every write re-reads the membership), at their next read within 30
  s (`getSessionMembership`, which every `/api` request calls), and at once when Directus refuses their token
  (`getUserClient` re-checks then). The 401 carries `data.reason = 'suspended'`; the client plugins send them to
  `/login?suspended=1`. An idle open page notices at its next heartbeat (every 2 minutes while in view, or on return);
  its realtime socket stops receiving this app's rows at once, since the policies are gone.
- **Timed suspensions** lift themselves: `currentMembership` (sign-in and the session checks) restores a membership
  whose `suspended_until` has passed (`source: 'expiry'`, `by: null`).
- **`onMembershipChange(listener)`** hears every change as `{ user, app, status, until, reason, by, source: 'app' |
  'expiry' | 'studio' }`. layers/st8-social uses it to log Studio edits and expiries (it logs its own suspensions
  itself) and to bring back what a suspension hid.

Who may suspend, and the moderation log, belong to layers/st8-social (its README, "Moderation").

## Where members join from (`memberships.joined_via`)

Another ST8 app's cross-app teaser (layers/st8-social's `SocialTeaser`) links here with
`?via=<app>:<collection>:<item>`, e.g. `/auth/register?via=summit:events:12`. On any page a signed-out visitor lands
on, `app/plugins/st8-join-via.client.ts` keeps it for a day in the `st8_via` cookie, so it survives the trip through
sign-up, sign-in or an invite. `completeSignIn` reads and clears the cookie (`takeJoinVia`); `parseJoinVia` accepts only
a known app other than this one, a collection in `st8Auth.joinViaCollections` and a short safe item; and
`ensureAppAccess(userId, app, { via })` writes it only on a membership it creates. An existing membership is never
changed, and members can't write memberships at all (their policy reads `id, app, role, status, joined_at` of their
own). It's attribution, not a permission: someone could hand-craft their own `?via=`, which only miscounts. Schema:
`memberships.joined_via` (string ≤120, read-only in the Studio), written by the server account.
