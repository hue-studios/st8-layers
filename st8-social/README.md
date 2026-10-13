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
| `server/lib/moderation.ts` | Reports (snapshot, one per member per target), which reports count toward auto-hide, auto-hide (comments, and targets with a `moderate` hook), moderating a host's target, the conflict rule, telling moderators and reporters, `signalTarget`, `moderation_log` |
| `server/lib/queue.ts` | The moderation queue's reads: reported targets grouped with their reports and the actions open to this moderator, the log, suspended members, the summary |
| `server/lib/review.ts` | The queue's actions on one target: dismiss, hide, unhide, remove, lock, unlock, clear, refer |
| `server/lib/suspensions.ts` | Suspend and restore a member here (rank, the optional hide of what they posted, the log, closed reports); logs Studio edits and expiries heard from layers/st8-auth |
| `server/plugins/st8-social-moderation.ts` | Listens to layers/st8-auth's `onMembershipChange` |
| `server/lib/targets.ts` | `deleteTargetSocial`: a target is gone for good; its conversation here goes with it |
| `server/lib/teasers.ts` | Cross-app teasers: other apps' totals on a target (counts and reaction keys only), threshold and blocks applied |
| `server/lib/notifications.ts` | Create (never to yourself, never across a block), reaction de-duplication, list, mark read; what a push of one says (`pushMessage`) |
| `server/lib/push.ts`, `server/lib/push-crypto.ts` | Web Push (below, "Push"): config, the endpoint allow-list, sending off the request path, the subscribe / unsubscribe / status routes, the removal paths; RFC 8291 encryption and RFC 8292 VAPID on Web Crypto (no dependency) |
| `server/plugins/st8-social-push.ts` | Push removal: st8-auth's `st8-auth:session-end` hook (sign-out) and `onMembershipChange` (any status but active) |
| `public/st8-sw.js` | The service worker: `push` (show it, set the app badge) and `notificationclick` (mark read, open the page). No `fetch` handler, no caching |
| `server/lib/people.ts` | Names, avatars and accent colours by id (never emails); mentionable checks; mention autocomplete |
| `server/api/social/*` | The routes (below) |
| `server/dev/reset-limits.ts` | Dev only: `POST /api/social/dev/reset-limits` clears the rate-limit counters. Not in production builds. |
| `shared/types/social.ts`, `shared/utils/social.ts` | Browser-facing shapes; the reaction set, report reasons, body rules, mention tokens |
| `app/composables/useSocialRealtime.ts` | One shared Directus WebSocket: handshake auth, re-auth before expiry, backoff, resume after sleep / offline / tab return, ping watchdog |
| `app/composables/useSocialTargets.ts` | `useSocialSummary(collection, item)`: batched counts for everything on screen, one realtime subscription for all of them; `useSocialTargets().isGone(key)`: the target vanished for this viewer since it was loaded |
| `app/composables/useSocialThread.ts` | `createThread`: the state behind `SocialThread` (tree, delta merge, optimistic writes with rollback) |
| `app/composables/useSocialNotifications.ts` | Unread count and list, live over realtime |
| `app/composables/useSocialPush.ts`, `app/plugins/st8-social-push.client.ts` | Push on this device: support (`supported`, `install` on iOS Safari outside the Home Screen, `unsupported`), permission, on/off, `enable` (asks for permission from the tap) / `disable`; the plugin checks the device on sign-in and on return, opens a tapped notification's page in an open window, and forgets the device at sign-out (`st8-auth:sign-out`) |
| `app/composables/useSocialModeration.ts` | Whether the member moderates here and how many reported targets wait (a menu badge); the action and log labels |
| `app/components/ResponsiveDialog.vue` | Dialog on desktop, bottom drawer on phones. Free for the host to reuse. |
| `app/components/social/*` | `SocialReactionBar` (variants `bar`, `compact`, `text`, `action`), `SocialReactionSummary`, `SocialReactionPicker`, `SocialReactionGlyphs`, `SocialReactorsDialog`, `SocialThread`, `SocialComment`, `SocialCommentBody`, `SocialComposer`, `SocialMentionTextarea` (the `@` autocomplete, free for host composers), `SocialReportDialog`, `SocialNotificationBell`, `SocialNotificationList`, `SocialAvatar`, `SocialTeaser` (another app's activity on the same row, with its join link), `SocialModerationQueue` (the whole queue: Needs review, Reviewed, Suspended, Log), `SocialModerationItem`, `SocialSuspendDialog`, `SocialPushSwitch` ("Notifications on this device"; also at the foot of the bell when push is on) |

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
  by `scripts/directus/schema.mjs`, and for push (optional) `push_subscriptions` (Insider's
  `scripts/directus/push-subscriptions.mjs`; the server account needs create, read, update and delete on it, nobody
  else anything). Keys: threads `app:collection:item`, reactions `app:collection:item:user`, reports
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
      ownedBy: async (user) => [],           // optional, with moderate: a member's published items (suspension hide)
      clear: async (item) => {},             // optional: clear what the owner wrote (a profile's bio, photo…)
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
      autoHideReports: 3,                     // counting pending reports that hide a comment (or moderate-able item)
      autoHide: { memberHours: 24, historyDays: 90, unreliableDismissed: 5, unreliableActionedRatio: 0.2 }, // which count
      teaserThreshold: 3,                     // another app's activity shows only from this many people (after blocks)
      blockMemoSeconds: 5,                    // a member's blocks are memoised this long per instance (0 = always read)
      limits: { comments: [10, 60], reactions: [60, 60], reports: [20, 3600], reportsDaily: [50, 86400],
                moderation: [120, 3600], suspensions: [20, 86400], teasers: [60, 60] }, // [max, seconds] per member
      push: { vapidPrivateKey: '', subject: '', types: ['reply', 'mention', 'connection_request', 'connection_accepted',
              'intro', 'moderation', 'report'], maxDevices: 10, unseenDays: 30, maxFailures: 5, ttlSeconds: 86400,
              limits: { subscribe: [20, 3600], status: [60, 60], recipient: [20, 600] } },          // "Push" below
    },
    public: {
      st8Social: {
        websocketUrl: '',                     // wss://…/websocket; empty = derived from public.directusUrl
        profilePath: '',                      // e.g. '/members/:id'; empty = names don't link
        teasers: [],                          // other apps whose activity shows as a teaser (below); empty = none
        moderationPath: '/moderation',        // the host's queue page; moderators' notifications link to it
        push: { vapidPublicKey: '', serviceWorker: '/st8-sw.js', icon: '', badge: '' }, // "Push" below
      },
    },
  }
  ```
- **UI**: the shadcn-vue base components in `~/components/ui/` (`avatar`, `button`, `dialog`, `drawer`,
  `dropdown-menu`, `label`, `popover`, `radio-group`, `sheet`, `skeleton`, `sonner`, `switch`, `textarea`, `tooltip`), the `cn`
  util, the `eyebrow` / `border-glass-border` / `text-brand` theme utilities, `@nuxt/icon` with the `lucide` and
  `fluent-emoji-flat` sets, `@vueuse/core`, a `<Toaster />` (from `~/components/ui/sonner`) mounted once and
  `vue-sonner/style.css` in the CSS. Tailwind must `@source` the layer directory.
- **Shared storage (production):** st8-auth's `mountSharedStore` moves `st8-social-rate-limit` onto the shared store
  (atomic counting), or the limits count per serverless instance.
- **Avatars:** `SocialAvatar` shows photos from st8-auth's `public.st8Auth.avatarUrl` (the Member avatars folder isn't
  public).

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
| `GET /api/social/moderation/summary` | `{ canModerate, role, pending }` for the signed-in member (any member may ask) |
| `GET /api/social/moderation/queue?tab=pending\|reviewed&before=` / `?target=<collection>:<item>` | Moderators: reported targets with their reports, state, preview and the actions open to them |
| `POST /api/social/moderation/resolve` | Moderators: `{ collection, item, action, reason? }`, action dismiss \| hide \| unhide \| remove \| lock \| unlock \| clear \| refer |
| `GET /api/social/moderation/log?before=` | Moderators: this app's log, newest first |
| `GET /api/social/moderation/suspended` | Moderators: members suspended here |
| `POST /api/social/moderation/suspend` | Moderators: `{ user, until: ISO \| null, reason, hideContent?, from?: { collection, item } }` |
| `POST /api/social/moderation/unsuspend` | Moderators: `{ user, restoreContent? }` |
| `POST /api/social/push/subscribe` | The browser's `PushSubscription.toJSON()`: turn push on for this device (allow-listed endpoint, valid keys; 20 changes an hour; at most `maxDevices`) |
| `POST /api/social/push/unsubscribe` | `{ endpoint }`: turn it off (the member's own rows only) |
| `POST /api/social/push/status` | `{ endpoint? }` → `{ configured, enabled }`; notes the device was seen (daily) and drops a row another member left on this browser |
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
- **Reports**: one per member per target, with a snapshot; you can't report your own; 20 an hour and 50 a day. A
  target's first pending report sends the app's moderators one `report` notification (not its owner or the reporter).
  At `autoHideReports` counting pending reports a comment (or a target with a `moderate` hook) is hidden (`hidden_by`
  null), logged as `auto_hide`, its author told and the moderators told again; the reports stay pending for the
  moderators. A report counts when its reporter joined the app at least `autoHide.memberHours` ago and their record
  isn't mostly dismissed (`unreliableDismissed` or more dismissed, under `unreliableActionedRatio` actioned, over
  `historyDays`); a report whose reporter's account was deleted since still counts. Every report reaches the queue,
  flagged when it doesn't count. Moderator actions close the pending reports (`actioned`, or `dismissed` when the item
  is left up) and tell each reporter it was reviewed ("took action" or "left it up"; never what, never by whom).
- **Moderation** (Phase 8). Moderators are members whose `memberships.role` is in `moderatorRoles` here; the queue
  (`SocialModerationQueue` on a host page at `moderationPath`; the host 404s it for everyone else) is the only way to
  reports and the log, which members' and moderators' Directus tokens can't read. Per target:
  - comments and items with `moderate`: dismiss (an item that's hidden comes back), hide (on one reports hid: "keep
    hidden", now by a person), unhide, remove, close / reopen comments (for a comment: on the item it's on), suspend
    the author;
  - items with `clear` (profiles): dismiss, clear content, suspend; they never auto-hide;
  - anything else (a shared event): dismiss, close comments, refer to admins (the reports close as actioned, the app's
    `admin` members get a `report` notification, and an admin fixes it at the source).

  Every action is logged (`moderation_log`, with the moderator) and the person moderated is told what happened, never
  by whom. **Conflicts**: nobody acts on their own things or on someone they have a block with, either way (403; the
  queue says why and offers nothing). **Suspension** (`suspend` / `unsuspend`; the switch itself is layers/st8-auth's):
  moderators suspend members; only admins suspend moderators; admins can't be suspended here (that's the Studio).
  `until` is a date (≤ 5 years) or null; a reason is required and only moderators see it. `hideContent` hides their
  published comments and their `ownedBy` items here (quietly, one log entry listing them); restoring can bring back
  exactly those that are still hidden, and a suspension that runs out does so by itself. `from` closes the reported
  item's reports. The suspended member isn't sent anything; restoring tells them "Your … membership is active again".
  A suspension made or lifted in the Studio is logged under the admin who did it (layers/st8-auth's `x-st8-actor`).
  Rate limits: 120 moderation actions an hour, 20 suspensions a day, per moderator.
- **`hidden_by` stays on the server**: reads with the member's token never ask for `comments.hidden_by` (whether a
  hidden comment was hidden by a person or by the threshold is looked up with the server account), so a member policy
  can leave the field out and an author never learns which moderator hid their comment.
- **Blocks** (`connections.status = blocked`, either direction; made and undone by layers/st8-network; `blockedWith`
  is memoised `blockMemoSeconds` per instance and cleared at once by a block or unblock made on that instance): each side's
  comments and reactions are hidden from the other and subtracted from the counts they see; no replies, reactions,
  mentions or notifications across a block.
- **Mentions**: a body may mention any active member of the app (the profile rule) who isn't blocked; the
  autocomplete lists fewer: people already in the thread, accepted connections, then `discoverable` members.
  `GET /api/social/mentions` without a target works too (a host composer for a new item). A host that lets its own
  items mention people checks them with `st8SocialServer.mentionable` and notifies with `notify` (type `mention`,
  target = the item): the bell then says "mentioned you in a <label>".
- **Notifications**: reply (to the parent's author, or `kind: comment` to the target's owner), mention, reaction (one
  per person per target, updated on switch, withdrawn on clear), moderation (never names the moderator: what happened
  to your item, your report or your membership), report (to moderators: a first report, an automatic hide, a
  referral; links to the queue, marked read once the target is reviewed). The bell
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
- **Push** (v0.5.0). Web Push to a member's devices, for the notifications above, while the app is closed (realtime
  keeps an open one current). Off until the host sets the VAPID pair and subject (below); then nothing else is needed
  but `push_subscriptions` and a place for `SocialPushSwitch` (the bell already has it).
  - **Turning it on** is per device and per app, from the switch only: permission is asked from the tap, never on load.
    iPhone and iPad deliver only to a Home Screen app (iOS 16.4+), so in a Safari tab the switch explains how to add it
    instead; a blocked permission is explained, never re-asked. The host needs an installable manifest
    (`display: standalone`) for that.
  - **What pushes**: `push.types` (reply, mention, connection request, accepted, intro, moderation, report). Never a
    reaction (a burst would buzz a phone dozens of times), a reviewed report or a restored membership (bell only).
    Each push is the bell's notification: title the app's name, body the actor's name and the bell's sentence (never the
    snippet or a note; a report's reason stays in the app; moderation and report pushes name nobody), the link, a tag
    (`<app>:<collection>:<item>` for activity on one item, `<app>:person:<id>`, `<app>:intro:<id>`,
    `<app>:moderation|report:<collection>:<item>`) so a newer push replaces the older on the device, and the unread
    count for the app badge. Tapping it marks it read and opens the page in the app.
  - **Sending**: `notify()` queues one push per notification, sent to each of the recipient's devices in this app after
    the response (Vercel's per-request `waitUntil`; on Vercel without it, before the response; elsewhere detached).
    Never across a block (notify makes nothing), never to a member who isn't active here (their devices are dropped),
    at most `limits.recipient` per recipient per window (more: bell only). Headers: `TTL`, `Urgency` (high for
    connection requests and reports), `Topic` (from the tag). 404/410 drops the device; other failures count, and
    `maxFailures` in a row drop it; 401/403 (a key mismatch) is logged loudly and counted, so a wrong key can't wipe
    every device at once.
  - **SSRF**: endpoints must be `https:` on the default port at `fcm.googleapis.com`, `*.push.services.mozilla.com`,
    `*.push.apple.com` or `*.notify.windows.com`; checked on subscribe and again before each send; redirects are never
    followed. Dev builds only: `NUXT_ST8_SOCIAL_PUSH_DEV_ENDPOINT` (an http loopback origin) is accepted too, for a
    probe's local push service; production builds don't contain that check.
  - **When a device goes**: switched off; signing out (st8-auth's `st8-auth:session-end` hook drops the device this
    session subscribed, and the page unsubscribes the browser); any membership status but active (all of the member's
    devices here); a deleted account (CASCADE); unseen for `unseenDays` (the app checks in at most daily); another
    member signing in on that browser (their status call drops the old owner's row); more than `maxDevices` (the ones
    seen longest ago). An endpoint is a bearer capability: it stays on the server and in the browser that made it.
  - **Keys**: one VAPID pair per app and environment. `NUXT_ST8_SOCIAL_PUSH_VAPID_PRIVATE_KEY` (server only: never in
    the repo or Directus), `NUXT_PUBLIC_ST8_SOCIAL_PUSH_VAPID_PUBLIC_KEY`, `NUXT_ST8_SOCIAL_PUSH_SUBJECT` (`mailto:`).
    Insider's `scripts/push-keys.mjs` makes them. Rotating the pair: open apps re-subscribe quietly where permission is
    granted; other devices are dropped as they fail.
  - **Service worker**: `/st8-sw.js` from this layer's `public/` (served `no-cache`), registered only when a member
    turns push on. Only one service worker controls a scope, so a host that later wants its own must fold this one in.
