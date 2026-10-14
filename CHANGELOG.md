# Changelog

## v0.5.1

From Insider's Phase 11 device checks. Nothing to change in a host app.

### Push (st8-social)

- **The switch agrees across windows.** A browser's tabs and its installed app are one device (one service worker, one
  subscription), but a window only rechecked after 5 minutes away, so turning push on in the browser left the installed
  app's switch off (and the other way round). Now a change in one window is announced to the others
  (`BroadcastChannel('st8-social-push')`), which recheck at once (a sign-out there just turns them off); a window
  rechecks every time it's shown, not only after 5 minutes; and the switch follows the notification permission as it
  changes in the browser's or the system's settings (`navigator.permissions`, where supported).
- `useSocialPush()` gains `follow(onChange)`, which the push plugin calls once.

## v0.5.0

Web Push for the installed app (Insider's Phase 11, `insider/docs/go-live-plan.md`). Off in every app until it sets
its VAPID keys, so Summit and Portal can take this release and change nothing.

### Push (st8-social)

- **Every notification `notify()` creates can also reach the member's devices** while the app is closed: replies,
  comments on their items, mentions, connection requests and accepts, intros (st8-network's types go through the
  same `notify()`), moderation notices and, for moderators, report notices. Not reactions, reviewed reports or a
  restored membership: bell only. The lock screen shows the app's name and the bell's sentence with the actor's name;
  never a comment, post or note snippet, never a report's reason, and moderation and report pushes name nobody. A tag
  per item, person or report lets a newer push replace the older; the unread count sets the app badge; tapping marks it
  read and opens the page in the app.
- **`SocialPushSwitch`** ("Notifications on this device"), at the foot of `SocialNotificationBell` and anywhere the
  host puts it. Permission is asked only from the tap. On iPhone and iPad in a Safari tab it explains Add to Home
  Screen instead (iOS delivers only to Home Screen apps); a blocked permission is explained, never re-asked.
  `useSocialPush()` is its state. The app badge follows the unread count (`useSocialNotifications`).
- **Routes**: `POST /api/social/push/subscribe`, `/unsubscribe`, `/status` (POST, so an endpoint never lands in a URL
  or a log). Endpoints must be one of the browsers' push services over https (fcm.googleapis.com,
  *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com), checked again before each send, redirects
  never followed. At most 10 devices per member per app; 20 subscription changes an hour.
- **Sending**: RFC 8291 encryption and RFC 8292 VAPID on Web Crypto, no dependency. After the response on Vercel (the
  per-request `waitUntil`), before it when that's missing. 404/410 drops a device, 5 failures in a row drop it, at
  most 20 pushes per recipient per 10 minutes.
- **Devices go** when switched off, at sign-out, when the membership is anything but active, with the account, after
  30 days unseen, and when someone else signs in on that browser.
- **`public/st8-sw.js`**: the service worker (push and notification taps only; no fetch handler, no caching),
  registered when a member turns push on.

### Hooks (st8-auth)

- **`st8-auth:session-end`** (Nitro, `{ event, session }`) runs in `endSession` before the cookie is cleared;
  **`st8-auth:sign-out`** (Nuxt app) runs in `useAuth().logout()` before the server call. `session.secure` gains
  `push_subscription` (st8-social's). Listeners never block a sign-out.

### Upgrading

1. Bump the ref: `"@hue-studios/st8-layers": "github:hue-studios/st8-layers#v0.5.0"`, `pnpm install`. Without keys,
   nothing changes (the switch doesn't render, no service worker is registered, `notify()` reads nothing more).
2. To turn push on:
   - **Directus**: the `push_subscriptions` collection (Insider's `scripts/directus/push-subscriptions.mjs`, already
     applied on the shared Directus) and create, read, update, delete on it for the app's server policy (Summit:
     `Summit Server` in summit-v2's `scripts/directus-st8-access.mjs`). No member, Public or partner access.
   - **Keys** (one pair per app and environment; Insider's `scripts/push-keys.mjs`):
     `NUXT_ST8_SOCIAL_PUSH_VAPID_PRIVATE_KEY` (server only), `NUXT_PUBLIC_ST8_SOCIAL_PUSH_VAPID_PUBLIC_KEY`,
     `NUXT_ST8_SOCIAL_PUSH_SUBJECT` (`mailto:` an ST8 address).
   - **Config**: `public.st8Social.push.icon` (the app icon) and `badge` (a monochrome PNG for Android's status bar).
   - **UI**: `switch` from shadcn-vue in `~/components/ui/` (the bell uses it); an installable manifest
     (`display: standalone`) for iPhones; `SocialPushSwitch` where members manage the device (Insider: `/profile`).
   - Check: a host route or service worker at `/st8-sw.js` would clash.

## v0.4.0

What Insider's launch follow-ups asked for (`insider/docs/st8-layers-requests.md` §6, §7).

### A busy Directus answers 503, not 500 (st8-auth)

Directus's pressure limiter (on by default, `PRESSURE_LIMITER_*`) refuses every request with 503 `SERVICE_UNAVAILABLE`
"Under pressure" while its own event loop is overloaded, whoever caused the load; seen from Insider's probes at 15–30
requests a second. The SDK throws a plain object, so routes answered 500.

- **`withDirectusRetry(client)`** (server util): every request on the client goes through **`retryDirectusBusy(run)`**,
  which retries a pressure-limiter 503 (only that 503: `extensions.reason: 'Under pressure'`), a 429
  `REQUESTS_EXCEEDED` or a connect-phase network error (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`, DNS) after 250 ms and
  750 ms, or Directus's `Retry-After` up to 2 s. Directus never ran those requests, so writes are retried too. Still
  busy: `createError({ statusCode: 503, data: { retryAfter: 2 } })`. Any other error is thrown as it came.
- **`st8-directus-busy` plugin**: a Nitro `error` hook that adds `Retry-After` to that 503.
- **The layer's own calls** use it: `directusAuthPost` (sign-in, refresh, logout, invite accept) and
  `streamDirectusAsset` (`/api/avatars`). A busy Directus at sign-in is now a 503, not a 500; refresh already answered 503
  for transient failures and now retries first.

### `syncAccess`: one row per policy when two syncs race (st8-auth)

On a first sign-in the app's `syncAccess` and the memberships Flow's can run at the same instant and both add the same
policy. After adding, `syncAccess` re-reads each added policy's rows and keeps the lowest `id`, deleting the rest
(counted in `removed`); overlapping syncs converge on the same row without a lock or a store. A delete that loses the
race (Directus answers 403 for a row that's already gone) is skipped quietly instead of being logged and counted in
`failed`. `removed` counts the deletes a sync sent, so racing syncs may each count the same duplicate. Checked from
Insider: the test partner's two Insider rows taken away, four syncs at once, six rounds: one row per policy every time.

### Upgrading

1. Bump the ref: `"@hue-studios/st8-layers": "github:hue-studios/st8-layers#v0.4.0"`, `pnpm install`.
2. Wrap the host's clients: `getDirectus()` and `getUserDirectus(token)` return
   `withDirectusRetry(createDirectus(url).with(staticToken(token)).with(rest()))` (auto-imported from the layer). Wrap
   any other SDK client the host makes for its own routes too (Summit: `useDirectus()`, the site-content client).
   Insider: drop its own copy (`server/utils/directus.ts`'s `withBusyRetry`, `server/plugins/directus-busy.ts`); the
   names would clash.
3. Nothing else: no runtime config, no Directus change.

## v0.3.0

What Insider's Phase 9 asked for (shared store, avatars, fewer Directus round trips).

### Shared store, counted atomically (st8-auth, st8-social, st8-network)

- **`mountSharedStore({ driver, mounts?, enabled?, url?, token? })`** (st8-auth server util). Call it from a Nitro plugin
  with `upstashDriver` from `unstorage/drivers/upstash`; the host installs `@upstash/redis` and `unstorage`. It moves
  `st8-auth-rate-limit` → `<app>:<env>:auth-rate-limit`, `st8-social-rate-limit` → `<app>:<env>:social-rate-limit` (when
  st8-social is there), `st8-network-cooldown` → `st8:<env>:network-cooldown`, and the host's own `mounts` (mount →
  name, under `<app>:<env>:`). `<env>` is `VERCEL_ENV`, else `local`. On by default on Vercel, off locally;
  `ST8_SHARED_STORE=1` / `=0` forces it, or pass `enabled`. Credentials: `KV_REST_API_URL` / `KV_REST_API_TOKEN`, else
  `UPSTASH_REDIS_REST_*`.
- **`countHit(mount, key, windowSec)`**: one Lua call on Redis/Upstash (`INCR`, then `PEXPIRE` on the first hit or a key
  that lost its expiry; returns the count and `PTTL`); in memory, one hit at a time per key on the instance.
  `enforceRateLimit` (st8-auth) and `limitRate` (st8-social, and so st8-network) count through it. Measured with two
  Summit servers on the store: 16 sign-in attempts on one email at once, split across both, let exactly 8 through
  (before: all 16); one at a time, the 9th is refused; the per-IP limit holds across both.
- **The withdraw cooldown has its own mount**, `st8-network-cooldown` (memory until moved): connections are global, so on
  the store it lives under `st8:<env>:`. Cooldowns kept on `st8-social-rate-limit` before are not carried over.

### Avatars (st8-auth, st8-social)

- **`GET /api/avatars/<id>?size=`** in st8-auth: the Member avatars folder isn't public, so photos are served by the
  server account. Only files that are someone's avatar (`isAvatarFile`, cached an hour); to signed-in visitors, plus
  host exceptions registered with **`registerAvatarAccess((event, id) => boolean)`**; sizes 64/128/256, square WebP,
  `private, max-age=604800, immutable`. **`streamDirectusAsset`** moved into st8-auth from Insider.
- **`public.st8Auth.avatarUrl`** (default `'/api/avatars/:id?size=:px'`; empty = Directus `/assets`, which only works
  while the folder is public), read by **`useAvatarUrl()`** / `avatarUrlFor()`. `SocialAvatar` uses it, so no layer
  component builds a Directus `/assets` URL any more. Uploads still go to `st8Auth.avatarFolder` /
  `DIRECTUS_AVATAR_FOLDER`.

### Fewer `connections` reads (st8-social, st8-network)

- **`blockedWith` is memoised per member for `st8Social.blockMemoSeconds` (default 5) per instance**; `0` turns it off.
  A block or unblock made through an instance clears both people there at once (`st8SocialServer.forgetBlocks`, called
  by st8-network's `setBlocked`); one made on another instance shows within the memo. Visibility still comes from the
  member's own token. A plain remove can't change blocks, so it doesn't clear.

### Upgrading Insider from v0.2.x

1. `pnpm add github:hue-studios/st8-layers#v0.3.0` (keep `unstorage` and `@upstash/redis`).
2. `server/plugins/shared-store.ts` becomes:
   ```ts
   import upstashDriver from 'unstorage/drivers/upstash'
   export default defineNitroPlugin(() => {
     const flag = process.env.INSIDER_SHARED_STORE
     mountSharedStore({
       driver: upstashDriver,
       mounts: { 'insider-link-preview': 'link-preview' },
       enabled: flag === '1' || (flag !== '0' && !!process.env.VERCEL),
     })
   })
   ```
   Keys stay `insider:<env>:auth-rate-limit:…`, `…:social-rate-limit:…`, `…:link-preview:…`; the cooldown moves to
   `st8:<env>:network-cooldown:…` (adjust `scripts/store-probe.mjs`' prefix checks).
3. Delete `server/utils/assets.ts` (`streamDirectusAsset` comes from the layer; keeping both gives duplicate-import
   warnings, and the host's copy wins). Either keep `server/api/avatars/[id].get.ts` (a host route at the same path
   replaces the layer's) or delete it and register the invite exception in a Nitro plugin:
   ```ts
   import { previewInvite } from '@hue-studios/st8-layers/st8-network/server/lib/invites'
   export default defineNitroPlugin(() => {
     registerAvatarAccess(async (event, id) => {
       const { invite } = getQuery(event)
       if (typeof invite !== 'string' || !invite) return false
       await st8SocialServer.limitRate(event, `avatar-invite:${getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'}`, [60, 60], 'Too many requests.')
       return (await previewInvite(invite, null)).inviter?.avatar === id
     })
   })
   ```
4. Delete `app/components/social/Avatar.vue` (the layer's now uses `public.st8Auth.avatarUrl`, whose default is the same
   `/api/avatars/:id?size=:px`).
5. `postContext`'s own `blockedWith` calls get the memo for free.

## v0.2.1

Pages with an `isr`, `swr` or `cache` route rule render signed out on the server (`st8-auth/server/plugins/st8-cached-pages.ts`).

## v0.2.0

Per-app `syncAccess`; `public.st8Auth.defaultAccess: 'public'`; the global profile (API, rules, types, composables)
moved into st8-auth; host-themed sign-in field shapes.

## v0.1.0

The layers as Insider ran them after Phase 8, split from `hue-studios/insider` (`layers/`) with their history.
