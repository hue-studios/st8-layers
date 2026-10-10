# st8-layers

Nuxt layers shared by the Southern Tier 8 apps (Industry Insider, Industry Summit, Portal). They run on the shared ST8
Directus (`manage.so-tier.com`): one `directus_users` table, the global `profiles` collection, and per-app access
through `memberships` → `app_role_policies` → `directus_access`.

| Layer | What it is | Needs |
|---|---|---|
| [`st8-auth`](st8-auth/README.md) | The ST8 sign-in: a sealed `nuxt-auth-utils` session over Directus, registration, password reset, invites, per-app access (`ensureAppAccess`, `syncAccess`) | — |
| [`st8-social`](st8-social/README.md) | Reactions, comments, reports, moderation, notifications, realtime; conversations are per app | `st8-auth` |
| [`st8-network`](st8-network/README.md) | The global member graph: connections, requests, blocks, intros, invite links | `st8-auth`, `st8-social` |

Each layer's README is its contract with the host app (runtime config, the server utils the host provides, the
shadcn-vue base components it imports from `~/components/ui/`, Tailwind `@source`, shared storage).

## Using it

Install it from a tag, so the lockfile pins the commit:

```bash
pnpm add github:hue-studios/st8-layers#v0.2.1
```

```ts
// nuxt.config.ts: list only the layers the app uses, dependencies first. Name each layer's nuxt.config: Nuxt
// can't resolve a bare package subfolder as a layer ("Cannot extend config from …"), and skips it with only a warning.
export default defineNuxtConfig({
  extends: [
    '@hue-studios/st8-layers/st8-auth/nuxt.config',
    '@hue-studios/st8-layers/st8-social/nuxt.config',
    '@hue-studios/st8-layers/st8-network/nuxt.config',
  ],
})
```

```css
/* main.css: Tailwind doesn't scan node_modules on its own */
@source '../../../node_modules/@hue-studios/st8-layers';
```

Browser-facing types are imported by path, e.g.
`import type { NetworkPerson } from '@hue-studios/st8-layers/st8-network/shared/types/network'`.

The host provides the peer dependencies (`nuxt`, `nuxt-auth-utils`, `@directus/sdk`, `@nuxt/icon`, `vue`; plus
`@vueuse/core` and `vue-sonner` for st8-social and st8-network).

## Changing it

- Nothing app-specific goes in here: the host names the app (`st8Auth.app`) and configures the rest at runtime.
- Every app shares one production Directus, so a change here can reach every app's members. Run each app's probes
  against a change before tagging it.
- Release: bump `version` in `package.json`, commit, tag `vX.Y.Z`, push the tag, then bump the ref in each app.

History before v0.1.0 lives in `hue-studios/insider` (`layers/`), from which this repo was split with its history.
