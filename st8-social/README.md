# layers/st8-social

The global ST8 social layer (docs/go-live-plan.md §5): reactions, comments with nested replies, reports with
auto-hide, moderator actions, notifications and realtime, shared by Insider, Summit and Portal. Nothing in it is
Insider-specific: the host says which collections are social targets and how to check that a member may see one.
Conversations are **per app**: each app has its own thread on a shared row (an event, say), with its own comments,
reactions, reports, moderators and notifications.

**Principles.** Every write goes through `server/api/social/*` (validate, check membership and target visibility,
rate-limit, recount, bump the thread version, log, notify). Directus permissions do the visibility: reads use the
member's own token. Realtime is a change signal (`threads.version`), never a raw subscription to comments.

## What's in it

| Path | What it does |
|---|---|
| `server/utils/st8-social.ts` | The public server API: `registerSocialTarget`, `socialTarget`, `useSt8Social` (config with defaults), `registerNotificationType` / `notificationType` (how the bell words and links a type another layer writes) |
| `server/utils/st8-social-server.ts` | `st8SocialServer`: the pieces other ST8 layers (layers/st8-network) and a host's own social content (Insider's posts) build on: `socialContext`, `blockedWith`, `resolvePeople`, `activeMembers`, `mentionable`, `snippetOf`, `notify`, `withdrawNotifications`, `markNotificationsRead`, `signalTarget`, `deleteTargetSocial`, `limitRate` (any key on the `st8-social-rate-limit` mount), `withLock`, `isUniqueViolation`. |
| `server/plugins/st8-social-comments.ts` | Registers `comments` itself as a target (reactions, reports) |
| `server/lib/core.ts` | Loosely typed Directus helpers, the per-key lock, rate limits, `socialContext(event)` (member, token client, blocks, moderator check) |
| `server/lib/threads.ts` | `requireTarget`, `getOrCreateThread`, `summarize` (counts for many targets in a fixed number of queries) |
| `server/lib/counters.ts` | `touchThread` / `recountComment`: recount from the source rows, write, verify, repeat (no atomic increments in Directus) |
| `server/lib/comments.ts` | Page and delta reads, groups ("View N more"), create / edit / delete / moderate / lock |
| `server/lib/reactions.ts` | Set, switch or clear one reaction per member per target; reactors list |
| `server/lib/moderation.ts` | Reports (snapshot, one per member per target), auto-hide (comments, and targets with a `moderate` hook), moderating a host's target, `signalTarget`, `moderation_log` |
| `server/lib/targets.ts` | `deleteTargetSocial`: a target is gone for good; its conversation here goes with it |
| `server/lib/teasers.ts` | Cross-app teasers: other apps' totals on a target (counts and reaction keys only), threshold and blocks applied |
| `server/lib/notifications.ts` | Create (never to yourself, never across a block), reaction de-duplication, list, mark read |
| `server/lib/people.ts` | Names, avatars and accent colours by id (never emails); mentionable checks; mention autocomplete |
| `server/api/social/*` | The routes (below) |
| `server/dev/reset-limits.ts` | Dev only: `POST /api/social/dev/reset-limits` clears the rate-limit counters. Not in production builds. |
| `shared/types/social.ts`, `shared/utils/social.ts` | Browser-facing shapes; the reaction set, report reasons, body rules, mention tokens |
| `app/composables/useSocialRealtime.ts` | One shared Directus WebSocket: handshake auth, re-auth before expiry, backoff, resume after sleep / offline / tab return, ping watchdog |
| `app/composables/useSocialTargets.ts` | `useSocialSummary(collection, item)`: batched counts for everything on screen, one realtime subscription for all of them; `useSocialTargets().isGone(key)`: the target vanished for this viewer since it was loaded |
| `app/composables/useSocialThread.ts` | `createThread`: the state behind `SocialThread` (tree, delta merge, optimistic writes with rollback) |
| `app/composables/useSocialNotifications.ts` | Unread count and list, live over realtime |
| `app/components/ResponsiveDialog.vue` | Dialog on desktop, bottom drawer on phones. Free for the host to reuse. |
| `app/components/social/*` | `SocialReactionBar` (variants `bar`, `compact`, `text`, `action`), `SocialReactionSummary`, `SocialReactionPicker`, `SocialReactionGlyphs`, `SocialReactorsDialog`, `SocialThread`, `SocialComment`, `SocialCommentBody`, `SocialComposer`, `SocialMentionTextarea` (the `@` autocomplete, free for host composers), `SocialReportDialog`, `SocialNotificationBell`, `SocialNotificationList`, `SocialAvatar`, `SocialTeaser` (another app's activity on the same row, with its join link) |

## Contract with the host app

The layer expects the host to provide:

- **`layers/st8-auth`**: the session, `getUserClient(event)`, `getCurrentUserId`, `getSessionMembership`,
  `readMembership`, `useSt8Auth().app` and `GET /api/websocket/token`. This layer's app key is st8-auth's `st8Auth.app`.
- **`getDirectus()` / `getUserDirectus(token)`** (as st8-auth requires). The server account must be able to CRUD
  `threads`, `comments`, `reactions`, `reports`, `moderation_log`, `notifications`; read `connections`, `memberships`,
  `profiles` (with `industry.color`) and `directus_users` (`id`, names, `avatar`, `title`, `status`); and read whatever
  the host's `visible()` hooks read. Insider's `Insider Server` policy is the reference.
- **Member policies, per app** (Insider: `Insider Member`, from `appSocialReads('insider')` in
  `scripts/directus/access.mjs`): read `threads` where `app = <app>` (`id`, `target_collection`, `target_item`, `app`,
  `comment_count`, `reaction_counts`, `last_activity_at`, `locked`, `version`); read `comments` where `thread.app =
  <app>` and (`status ∈ {published, removed, deleted}` or `author = $CURRENT_USER`); read `reactions` where `app =
  <app>`; read `notifications` where `recipient = $CURRENT_USER` and `app = <app>`. Plus, shared by every app (`ST8
  Social`), their own `connections` (see layers/st8-network's README for the exact filter: a declined request is
  readable only by its addressee, a block only by the blocker). No writes. Moderators additionally read all of their app's `comments` (Insider:
  `Insider Moderator`: `thread.app = insider`, granted through `memberships.role` → `app_role_policies`). Keeping these
  reads in the app's policy is what stops one app's members reading another app's conversations through the
  Directus API or realtime.
- **Schema**: `threads`, `comments`, `reactions` (with `app`), `reports`, `moderation_log`, `notifications` as created
  by `scripts/directus/schema.mjs`. Keys: threads `app:collection:item`, reactions `app:collection:item:user`, reports
  `app:collection:item:reporter`.
- **Targets**, registered from a Nitro plugin:

  ```ts
  // server/plugins/social-targets.ts
  export default defineNitroPlugin(() => {
    registerSocialTarget({
      collection: 'events',                  // stored as target_collection
      label: 'event',                        // "reacted to your event", "Report event"
      comments: true, reactions: true,       // and/or reports: true
      visible: async (items, { event, viewer }) => new Set(/* the ids this viewer may see, one query */),
      owners: async (items) => new Map(),    // optional: item → owning user (notified; can't report their own)
      snapshot: async (item) => ({}),        // optional: kept on reports
      link: (item, { comment }) => `/events/${item}${comment ? `?comment=${comment}` : ''}`, // optional
      moderate: { state, apply },            // optional: moderation of the item itself (below)
    })
  })
  ```

  Nothing is reactable, commentable or reportable until it's registered; an unregistered collection is a 400, an item
  `visible()` leaves out is a 404 (on reads and writes alike). Comments inherit their thread's target's visibility.
- **Moderating the host's own items** (Phase 6, Insider's posts): a target may pass `moderate: { state(item), apply(item,
  action, { moderator, reason }) }`. `state` returns `{ status: 'published' | 'hidden' | 'removed', owner }` (or null);
  `apply` changes the host's row (for `remove`: clear the content and delete what only the item used). With it,
  moderators can hide, unhide and remove the item through `POST /api/social/targets/moderate`, and `autoHideReports`
  distinct pending reports hide it (`moderator` null). The layer checks the transition, logs it with the target's
  `snapshot`, closes pending reports (not on an automatic hide), tells the owner (never who did it) and bumps the
  thread's version. `visible()` must still return hidden items to moderators (and to their owner), or they can't be
  unhidden.
- **When a host item changes visibility or goes away**: call `st8SocialServer.signalTarget(collection, item)` after a
  change others must notice (the layer does it for moderation), and `st8SocialServer.deleteTargetSocial(collection,
  item)` when the item is deleted for good (its comments, their reactions and notifications, its reactions, the
  notifications about it and its thread go; reports and the log keep their snapshots). Both bump the thread version
  first, so open views refetch; a summary read that leaves the item out marks it gone (`useSocialTargets().isGone`),
  which is how a host list learns to drop it.
- **Runtime config** (all optional; defaults shown):

  ```ts
  runtimeConfig: {
    st8Social: {
      moderatorRoles: ['moderator', 'admin'], // memberships.role values that may hide, remove, lock
      editWindowMinutes: 15,                  // or any time before the first reply
      autoHideReports: 3,                     // distinct pending reports that hide a comment
      teaserThreshold: 3,                     // another app's activity shows only from this many people (after blocks)
      limits: { comments: [10, 60], reactions: [60, 60], reports: [20, 3600], teasers: [60, 60] }, // [max, seconds] per member
    },
    public: {
      st8Social: {
        websocketUrl: '',                     // wss://…/websocket; empty = derived from public.directusUrl
        profilePath: '',                      // e.g. '/members/:id'; empty = names don't link
        teasers: [],                          // other apps whose activity shows as a teaser (below); empty = none
      },
    },
  }
  ```
- **UI**: the shadcn-vue base components in `~/components/ui/` (`avatar`, `button`, `dialog`, `drawer`,
  `dropdown-menu`, `label`, `popover`, `radio-group`, `sheet`, `skeleton`, `sonner`, `textarea`, `tooltip`), the `cn`
  util, the `eyebrow` / `border-glass-border` / `text-brand` theme utilities, `@nuxt/icon` with the `lucide` and
  `fluent-emoji-flat` sets, `@vueuse/core`, a `<Toaster />` (from `~/components/ui/sonner`) mounted once and
  `vue-sonner/style.css` in the CSS. Tailwind must `@source` the layer directory.
- **Shared storage (production):** mount a shared driver (Upstash, Vercel KV, Redis) on `st8-social-rate-limit` in
  `nitro.storage`, or the limits count per serverless instance.

## API

| Route | What it does |
|---|---|
| `GET /api/social/threads?t=events:12&t=…` | Summaries for up to 60 targets: counts as the viewer sees them, their reaction, two reactors, locked, version |
| `POST /api/social/threads` | Get or create a target's thread |
| `POST /api/social/threads/lock` | Moderators: `{ collection, item, locked }` |
| `GET /api/social/comments?collection&item` | A page of top-level comments (newest first, `&before=` for older) with the newest 2 replies per group |
| `GET /api/social/comments?…&since=<cursor>&roots=<ids>` | The delta after a version bump: changed comments, plus the ids still visible |
| `POST /api/social/comments` | `{ collection, item, body, parent? }`; mentions are `<@user-id>` tokens |
| `PATCH /api/social/comments/[id]` | Author edit: within the window, or before anyone replies |
| `DELETE /api/social/comments/[id]` | Author delete: hard without replies, `[deleted]` tombstone with them |
| `GET /api/social/comments/[id]/replies` | A whole group ("View N more replies") |
| `POST /api/social/comments/[id]/moderate` | Moderators: `{ action: hide \| unhide \| remove, reason? }` |
| `PUT /api/social/reactions` | `{ collection, item, reaction \| null }` |
| `GET /api/social/reactions?collection&item` | Who reacted, with what |
| `POST /api/social/reports` | `{ collection, item, reason, details? }` |
| `POST /api/social/targets/moderate` | Moderators: `{ collection, item, action: hide \| unhide \| remove, reason? }` on a target with a `moderate` hook |
| `GET /api/social/notifications`, `POST /api/social/notifications/read` | The bell: list (this app's), unread count, mark read (`ids` or `all`) |
| `GET /api/social/mentions?q&collection&item` | Autocomplete (see below) |
| `GET /api/social/teasers?t=events:12&t=…` | Cross-app teasers for up to 30 targets: `{ app, teasers: { 'events:12': [{ app, people, comments, reactions, member }] } }` (below) |

## Behaviour notes

- **Nesting**: any depth is stored (`parent`, `root`); `depth` is capped at 2. A reply to a depth-2 comment is stored
  under it, rendered in the same depth-1 group, and shows "↪ @name". If a depth-1 parent is hidden or blocked, its
  visible replies keep a "not available" placeholder.
- **Per app**: every read, count and write is scoped to `st8Auth.app`. Another app's comment is a 404 here, for its
  author and for this app's moderators; the bell lists this app's notifications only.
- **Counters** are recomputed from the source rows on every write and re-verified, so they converge on the exact
  count under concurrency, across instances too. `version` is a change signal: clients refetch on any change, not
  only an increase.
- **Hidden** comments vanish for everyone but their author (banner) and moderators (banner, Unhide). **Removed** and
  author-**deleted** comments with replies are tombstones with their body cleared; a `[deleted]` tombstone that loses
  its last reply is deleted too.
- **Reports**: one per member per target, with a snapshot; you can't report your own. At `autoHideReports` distinct
  pending reports a comment (or a target with a `moderate` hook) is hidden (`hidden_by` null), logged as `auto_hide`,
  and its author is told; the reports stay pending for the moderators. Moderator actions close the pending reports
  (`actioned`, or `dismissed` on unhide) and are logged.
- **`hidden_by` stays on the server**: reads with the member's token never ask for `comments.hidden_by` (whether a
  hidden comment was hidden by a person or by the threshold is looked up with the server account), so a member policy
  can leave the field out and an author never learns which moderator hid their comment.
- **Blocks** (`connections.status = blocked`, either direction; made and undone by layers/st8-network): each side's
  comments and reactions are hidden from the other and subtracted from the counts they see; no replies, reactions,
  mentions or notifications across a block.
- **Mentions**: a body may mention any active member of the app (the profile rule) who isn't blocked; the
  autocomplete lists fewer: people already in the thread, accepted connections, then `discoverable` members.
  `GET /api/social/mentions` without a target works too (a host composer for a new item). A host that lets its own
  items mention people checks them with `st8SocialServer.mentionable` and notifies with `notify` (type `mention`,
  target = the item): the bell then says "mentioned you in a <label>".
- **Notifications**: reply (to the parent's author, or `kind: comment` to the target's owner), mention, reaction (one
  per person per target, updated on switch, withdrawn on clear), moderation (never names the moderator). The bell
  lists this app's notifications only. Other layers add types with `registerNotificationType(type, { text, link })`
  from a Nitro plugin (st8-network: `connection_request`, `connection_accepted`, `intro`); a row's `data.with` (another
  member) is resolved for them.
- **Realtime**: the components subscribe to `threads` (`id`, `version`, target) for what's on screen and to the
  member's own `notifications`. A bump refetches the summary, or the open thread's delta.
- **Cross-app teasers**: threads are per app, so another app's conversation on the same row is a reason to join it.
  `public.st8Social.teasers` lists the apps whose activity this app shows (`{ app, label, joinUrl, openUrl? }`; in the
  URLs `{via}` becomes `<this app>:<collection>:<item>`, `{collection}` and `{item}` the target). `GET
  /api/social/teasers` reads those apps' threads with the server account (members' tokens can't, by design) and returns
  counts and reaction keys only: distinct people (published comments and reactions), comments, the top three reaction
  keys, and whether the viewer is a member there. Never names, ids or text, never this app's own totals. People blocked
  with the viewer (either way) are left out, then an app below `teaserThreshold` people is left out entirely, so a
  count on a quiet row can't point at a person. Targets the viewer can't see (`visible()`) get nothing. The raw totals
  are cached two minutes per app and target. `SocialTeaser` shows them with a join link (or `openUrl` for members
  there); the join link's `via` is recorded on the new membership by layers/st8-auth (`joined_via`). Each app chooses
  whose totals it shows; the other app's side needs nothing but its threads.
