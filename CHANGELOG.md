# Changelog

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
