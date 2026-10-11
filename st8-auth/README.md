# st8-auth

The shared ST8 login and the global profile: a sealed `nuxt-auth-utils` session over Directus users, per-app access,
and the member's own profile (insider/docs/go-live-plan.md §2–§3). Used by Insider (a members-only app) and Summit (a
public site with accounts). Nothing in it is app-specific; the host names the app in runtime config.

## What's in it

| Path | What it does |
|---|---|
| `server/utils/auth.ts` | `getValidToken` (refresh single-flight, a just-rotated refresh token answered from memory for a minute, sliding 30-day window, keeps a still-valid token when a refresh fails, 401 only when Directus rejects the refresh token), `getUserClient` (re-checks the membership when Directus refuses the member), `getCurrentUserId` (from the session, no `/users/me`), `getSessionMembership` (re-read on every write and every 30 s; see "Suspension"), `startSession` / `endSession`, `revalidateSession`, `refreshSessionUser`, `suspendedMessage` |
| `server/utils/app-access.ts` | `ensureAppAccess(userId, app)` (open signup: creates the membership, then syncs), `syncAccess(userId)` (memberships → `app_role_policies` → `directus_access`), `readMembership`, `currentMembership` (lifts a suspension that has run out), `suspendMembership` / `restoreMembership`, `onMembershipChange` |
| `server/plugins/st8-cached-pages.ts` | Pages with an `isr` / `swr` / `cache` route rule render signed out on the server (cookies dropped; nuxt-auth-utils loads the session in the browser after hydration), so a cached page never carries anyone's session |
| `server/middleware/st8-membership.ts` | Every `/api` request with a session (not `/api/auth/*`) re-checks the membership through `getSessionMembership` |
| `server/utils/profile.ts` | `fetchProfile` (`directus_users` + `profiles` with `industry.name/color`), `fetchSessionUser`, `ensureProfile` |
| `server/utils/own-profile.ts` | The member's own profile: `readOwnProfile`, `applyProfileUpdate` (names and title with their token, the `profiles` row and county links with the server account; only the keys sent), `allowedProfileChoices`, avatars (`sniffImage`, `encodeAvatar`: sharp re-encode to WebP ≤1024px with no metadata, `uploadAvatarFile` into `st8Auth.avatarFolder`, `deleteOldAvatar`), and for hosts that show other people: `readProfileRecord`, `toMemberSummary`, `toMemberProfile`, `requireActiveMember`, `isUuid` |
| `server/api/profile/*` | `GET` / `PATCH /api/profile` (`OwnProfileResponse`), `POST` / `DELETE /api/profile/avatar` |
| `server/api/{industries,counties}.get.ts` | The published industries and counties (cached): profile choices, and free for the host |
| `server/utils/sign-in.ts` | `completeSignIn`: suspended check → `ensureAppAccess` → `ensureProfile` → session |
| `server/utils/users.ts` | `findUserByEmail` (case-insensitive; some legacy emails are mixed-case) |
| `server/utils/directus-busy.ts`, `server/plugins/st8-directus-busy.ts` | A busy Directus: `withDirectusRetry(client)` (the host wraps its two clients), `retryDirectusBusy(run)`, `DIRECTUS_BUSY_RETRY_AFTER`; the plugin adds `Retry-After` to the 503 |
| `server/utils/rate-limit.ts` | `enforceRateLimit` (fixed window in the `st8-auth-rate-limit` storage mount, counted by `countHit`) |
| `server/utils/shared-store.ts` | `mountSharedStore` (moves the layers' storage mounts onto the shared Upstash store, below) and `countHit` (one atomic `INCR` + expiry on Redis/Upstash; one hit at a time per key in memory) |
| `server/utils/avatars.ts`, `server/utils/assets.ts`, `server/api/avatars/[id].get.ts` | Member photos: `GET /api/avatars/<id>?size=` (only files that are someone's avatar; signed-in visitors, plus host exceptions from `registerAvatarAccess`), `streamDirectusAsset` |
| `app/composables/useAvatarUrl.ts`, `shared/utils/avatar-url.ts` | A photo's URL from `public.st8Auth.avatarUrl` (default the route above) |
| `server/utils/join-via.ts` | `parseJoinVia`, `takeJoinVia`: where a new member came from (`memberships.joined_via`, below) |
| `server/utils/email-send.ts`, `emails/` | SendGrid v3 REST sender (no SDK) and the password-reset, welcome and invite templates |
| `server/api/auth/*` | `login`, `register`, `logout`, `refresh`, `heartbeat`, `password-request`, `password-reset`, `accept-invite`, `sync-access` |
| `server/api/websocket/token.get.ts` | The access token for the realtime handshake (see "Tokens" below) |
| `server/dev/session.ts` | Dev-only `/api/auth/dev/session`: inspect the session, simulate an expired token. Not in production builds. |
| `app/middleware/auth.global.ts` | Members-only pages (`isMembersOnlyRoute`, `app/utils/st8-access.ts`) send a signed-out visitor to sign in; which pages those are depends on `public.st8Auth.defaultAccess` (below) |
| `app/composables/useAuth.ts` | `login`, `register`, `requestPasswordReset`, `resetPassword`, `acceptInvite`, `logout` (a public site keeps you on the page), plus `authError()` |
| `app/composables/useOwnProfile.ts`, `useIndustries.ts`, `useCounties.ts` | The member's profile with `save` / `uploadAvatar` / `removeAvatar`; the choices |
| `app/utils/profile-form.ts` | `toDraft`, `profileChanges` (what a form should PATCH), `checkProfileUpdate` (the server's rules, client side), `profileError`, `downscaleImage` |
| `app/plugins/session-resume.client.ts` | Pings the heartbeat when the app returns to the foreground, and every 2 minutes while it's in view |
| `app/plugins/session-guard.client.ts` | Wraps the global `$fetch`: any `/api` 401 (outside `/api/auth/*`) means the session ended; go to sign-in (`?suspended=1` for a suspension) |
| `app/composables/useSessionEnded.ts` | What both plugins do on a 401: re-read the session, then `/login?redirect=…` |
| `app/plugins/st8-join-via.client.ts` | Keeps another app's `?via=` for a day (cookie `st8_via`) so sign-up or sign-in can record it |
| `app/pages/` | `/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/accept-invite` |
| `app/components/auth/` | The forms (`AuthLoginForm`, `AuthRegisterForm`, `AuthForgotPasswordForm`, `AuthNewPasswordForm`) and their pieces |
| `shared/types/auth.d.ts` | The typed session (`#auth-utils` augmentation) |
| `shared/types/profile.ts`, `shared/utils/profile.ts`, `shared/utils/slug.ts` | Profile shapes (`OwnProfile`, `MemberProfile`, …), the input rules both sides run (`normalizeProfileUpdate`, `PROFILE_LIMITS`, onboarding steps), `slugify` |

## Contract with the host app

The layer expects the host to provide:

- **`getDirectus()` and `getUserDirectus(token)`** as Nitro server utils (Insider: `server/utils/directus.ts`).
  `getDirectus()` is a scoped service account that can, at minimum: read `directus_users` (`id`, `email`,
  `first_name`, `last_name`, `avatar`, `title`, `status`, `role`); create users with `role`/`status` as presets
  (never writable fields); update `password` and the name/avatar fields, but not on administrators or role-less
  service accounts (those reset through Directus; the reset route says so); read all `memberships` and create/update
  this app's (including `status`, `suspended_until`, `suspended_reason`, which suspension writes); create/read/update
  `profiles` and `password_reset_tokens`, and CRUD `profiles_counties`; read `app_role_policies`, `industries`,
  `counties`; read `directus_access`, and create/delete user-level rows for **this app's** mapped policies only; create
  and read `directus_files` and delete replaced avatars in the avatar folder. References: Insider's `Insider Server`
  (insider `scripts/directus/access.mjs`) and Summit's `Summit Server` (summit-v2 `scripts/directus-st8-access.mjs`).
- **Both clients wrapped in `withDirectusRetry(...)`** (since v0.4.0): `return withDirectusRetry(createDirectus(url)
  .with(staticToken(token)).with(rest()))`. A request Directus refused without running it (its pressure limiter's 503
  "Under pressure", a 429 `REQUESTS_EXCEEDED`, a connection that never opened) is retried after 250 ms and 750 ms (or
  its `Retry-After`, up to 2 s), writes too; still busy, the route answers 503 with `Retry-After: 2` (the layer's
  `st8-directus-busy` plugin adds the header) instead of a 500. Other errors pass through. The layer's own calls to
  Directus (sign-in, refresh, invite accept, `streamDirectusAsset`) do the same through `retryDirectusBusy(run)`.
- **Runtime config:**

  ```ts
  runtimeConfig: {
    st8Auth: {
      app: 'insider',            // required: insider | summit | portal
      apps: { insider: '' },     // apps a reset link may open (app → origin; '' = this app's APP_URL)
      joinViaCollections: ['events'], // collections another app's join link may name in ?via= (the default)
      timeZone: 'America/New_York',     // dates shown to members (a suspension's end); the default
      avatarFolder: '',          // Directus Files folder for avatars; '' = env DIRECTUS_AVATAR_FOLDER ("Member avatars")
    },
    public: {
      appUrl: '…',               // this app's public origin
      directusUrl: '…',
      st8Auth: {
        appName: 'Industry Insider',
        defaultAccess: 'members', // 'members': every page needs a session except publicRoutes / meta auth: false
                                  // 'public': every page is open except protectedRoutes / meta auth: true (Summit)
      },
    },
  }
  ```

  Optional: `st8Auth.syncSecret` (or env `ST8_ACCESS_SYNC_SECRET`; unset = `/api/auth/sync-access` is off),
  `st8Auth.sendgrid*` (or env `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, `SENDGRID_REPLY_TO`;
  no key = emails are a logged no-op), `public.st8Auth.brandColor`, `public.st8Auth.publicRoutes` /
`protectedRoutes`, `public.st8Auth.postJoinPath` (see "Hooks" below).
- **Public sites:** with `defaultAccess: 'public'`, an ended session leaves the visitor signed out on the page they're
  reading (only a suspension goes to sign-in, for its notice), and so does signing out. Pages cached for everyone (an
  `isr`, `swr` or `cache` route rule) render signed out on the server and pick the session up in the browser
  (`server/plugins/st8-cached-pages.ts`); render account UI in them client-only.
- **An `auth` layout** the pages render in, the shadcn-vue base components (`~/components/ui/{alert,button,field,input}`),
  the `cn` util, the `eyebrow` / `glass` / `border-glass-border` theme utilities, and `@nuxt/icon` with the `lucide`
  set. Shapes follow the host: `--st8-auth-radius` (fields and the submit button; default 9999px, pills) and
  `--st8-auth-panel-radius` (notices; default 1rem), set on `:root`. `sharp` (avatar re-encoding) is a peer dependency.
- **Tailwind sources:** the host's CSS must `@source` the layer directory (Insider: `app/assets/css/main.css`).
- **Shared storage (production):** call `mountSharedStore` from a Nitro plugin (below), or the rate limits count per
  serverless instance.
- **Avatars:** photos go to `st8Auth.avatarFolder` ("Member avatars"), which isn't public; show them with
  `useAvatarUrl()` (default `/api/avatars/:id?size=:px`, served by the layer), never a Directus `/assets` URL. A host
  that must show a photo to signed-out visitors registers the case with `registerAvatarAccess((event, id) => …)`. A
  host route at the same path replaces the layer's.

## The shared store

One Upstash Redis database (`st8`, Vercel Marketplace: `KV_REST_API_URL`, `KV_REST_API_TOKEN`) for every ST8 app. Mount it
at runtime from a Nitro plugin, so the token never reaches the build:

```ts
// server/plugins/shared-store.ts
import upstashDriver from 'unstorage/drivers/upstash'
export default defineNitroPlugin(() => {
  mountSharedStore({ driver: upstashDriver, mounts: { 'insider-link-preview': 'link-preview' } }) // mounts: the host's own, optional
})
```

- On by default on Vercel (Production and Preview), off locally; `ST8_SHARED_STORE=1` / `=0` forces it, or pass
  `enabled`. The host installs `@upstash/redis` (the driver's client).
- Keys: `<app>:<VERCEL_ENV|local>:<name>:…`: `auth-rate-limit`, `social-rate-limit` (when st8-social is there) and the
  host's `mounts`; the network's withdraw cooldown is global across ST8 (connections are), so it goes under
  `st8:<env>:network-cooldown`.
- Counting is atomic there (`countHit`: one Lua call, `INCR` then `PEXPIRE` on the first hit), so parallel requests on
  different instances can't both pass a limit.
- Leave Nitro's `cache` mount in memory: cached functions read their storage on every call and swr entries are written
  without a TTL.

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
3. `syncAccess(userId)` makes the user's `directus_access` rows for **this app's** policies (user-level rows whose
   policy appears in `app_role_policies` for `st8Auth.app`) match their active memberships: the policies wanted are
   the union over all their apps' active memberships, so a policy two apps map (ST8 Social) stays while either is
   active. Another app's policies, role-level rows and rows for unmapped policies (Studio, admin, anything else
   attached by hand) are never touched: each app's server account can only grant its own app's policies.

It runs on every sign-in and from `POST /api/auth/sync-access`, which the Directus Flow
`ST8 · Reconcile access on memberships` calls on memberships create/update/delete, **once per app**
(insider `scripts/directus/memberships-flow.mjs`). The Flow also sends `x-st8-actor` (`{{$accountability.user}}`), so a
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
