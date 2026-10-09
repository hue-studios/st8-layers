# layers/st8-network

The global ST8 member graph (docs/go-live-plan.md §4): connection requests, connections, quiet declines, blocks,
introductions and personal invite links, shared by Insider, Summit and Portal. **Connections are global**: one edge per
pair across ST8 (`connections.unique_key`), so someone you connect with at the Summit is in your Insider orbit too. The
notifications they send belong to the app the member acted in (social conversations are per app, connections are not).
Nothing in it is Insider-specific: the pages that show a network (an Orbit, a list, member search, people you may
know) belong to the host.

**Principles.** Every write goes through `server/api/connections/*` and `server/api/invites/*` (validate, check
membership, rate-limit, lock the pair, handle the unique-key race, notify). Reads of the member's own edges use their own
token, so Directus decides what they see: a declined request is invisible to its sender, a block to the blocked member.
Realtime is a subscription to the member's own `connections` rows; any event refetches the overview.

## What's in it

| Path | What it does |
|---|---|
| `server/utils/st8-network.ts` | The public server API: `useSt8Network` (config with defaults), `networkRateLimit`, and the reads a host's people lists need: `networkStates(me, ids)`, `networkConnections(me)`, `networkMutuals(me, ids)`, `networkSecondDegree(me)` |
| `server/lib/edges.ts` | The pair key, edge reads, `stateFor` (how the viewer stands with someone), mutual connections, second degree |
| `server/lib/actions.ts` | request, accept, decline, cancel, remove, block, unblock, intro, each under a lock on the pair |
| `server/lib/overview.ts` | `GET /api/connections`: connections (ranked), requests in and out, blocks |
| `server/lib/ranking.ts` | The Orbit ranking (below) |
| `server/lib/invites.ts` | Personal links: get or mint, reset, public preview, redeem (once per person per link) |
| `server/lib/people.ts` | People as the network shows them (names, photo, title, organization, headline, industry colour, `member`); never an email |
| `server/plugins/st8-network-notifications.ts` | How the bell words and links `connection_request`, `connection_accepted` and `intro` (st8-social's `registerNotificationType`) |
| `shared/types/network.ts` | Browser-facing shapes |
| `app/composables/useConnections.ts` | The member's network app-wide: overview, `stateOf(id)`, `request` / `accept` / `decline` / `cancel` / `remove` / `block` / `unblock` / `introduce` with optimistic state, live over realtime |
| `app/composables/useNetworkInvite.ts` | Carries an invite code through sign-up or sign-in (a cookie set only by a click), and redeems it |
| `app/plugins/st8-network-invite.client.ts` | Redeems a remembered invite on the first page a signed-in member reaches |

## Contract with the host app

The layer expects the host to provide:

- **`layers/st8-auth`** (session, `getUserClient`, `getSessionMembership`, `public.appUrl`, `st8Auth.app`) and
  **`layers/st8-social`**, whose server surface `st8SocialServer` (member context, blocks, people, notifications,
  rate limits on the `st8-social-rate-limit` mount, locks), `registerNotificationType`, `useSocialRealtime`,
  `socialError` and `ResponsiveDialog` it builds on.
- **`getDirectus()`** (as st8-auth requires). The server account must be able to CRUD `connections`, `invites`,
  `invite_redemptions` and `notifications`, and read `profiles` (with `industry`), `memberships` and `directus_users`
  (`id`, names, `avatar`, `title`, `status`). Insider's `Insider Server` policy is the reference.
- **The member read policy, shared by every app** (Insider: `ST8 Social`, `scripts/directus/access.mjs`):
  - `connections` read: `{ _or: [ { status ∈ {pending, accepted}, requester or addressee = $CURRENT_USER }, { status =
    declined, addressee = $CURRENT_USER }, { status = blocked, requester = $CURRENT_USER } ] }`, fields `id`,
    `requester`, `addressee`, `status`, `date_created`, `date_updated`. This is what makes a decline quiet and a block
    invisible to the blocked member, through REST and realtime alike.
  - `invites` read: `inviter = $CURRENT_USER`, fields `id`, `code`, `expires_at`, `accepted_at`, `app`, `date_created`.
  - No writes, and nothing on `invite_redemptions`.
- **Schema** (`scripts/directus/schema.mjs`): `connections` (`unique_key` = the two user ids sorted and joined by `:`;
  `requester`, `addressee`, `status` ∈ pending / accepted / declined / blocked, `app` = where it was made; a block's
  requester is the blocker), `invites` (`code` unique, `inviter`, `expires_at`, `accepted_by`, `accepted_at`, `app`),
  `invite_redemptions` (`unique_key` = `<invite>:<user>`, `invite`, `user`), and the `intro` choice on
  `notifications.type`.
- **Runtime config** (all optional; defaults shown):

  ```ts
  runtimeConfig: {
    st8Network: {
      limits: {                                  // [max, seconds] per member (invite previews: per IP)
        requests: [20, 86400], responses: [120, 3600], blocks: [30, 86400], intros: [10, 86400],
        redeems: [10, 3600], inviteResets: [5, 86400], search: [60, 60], invitePreview: [60, 60],
      },
      maxOutgoing: 100,                          // open requests at once
      withdrawCooldownDays: 21,                  // after withdrawing, before asking the same person again
      inviteDays: 30,                            // how long a personal link works
      introRepeatDays: 30,                       // the same intro again inside this is a no-op
      ranking: { interaction: 0.5, recency: 0.3, mutuals: 0.2, interactionHalfLifeDays: 30,
                 interactionWindowDays: 180, recencyHalfLifeDays: 60, dailyCap: 3 },
    },
    public: {
      st8Network: {
        connectionsPath: '/connections',         // the requests inbox is `?tab=requests`
        invitePath: '/i/',                       // links are <public.appUrl><invitePath><code>
        inviteCookie: 'st8_invite',
      },
    },
  }
  ```

  Profile links come from st8-social's `public.st8Social.profilePath`.
- **An invite landing page** at `invitePath` + `:code` (public: add it to st8-auth's `publicRoutes`, which already
  holds `/i/`). It reads `GET /api/invites/[code]`; signed out, its join and sign-in buttons call
  `useNetworkInvite().remember(code)` before going to sign-up or sign-in with `?redirect` back to the landing; signed in,
  it redeems with `useNetworkInvite().redeem(code)` (automatically when the remembered code matches, otherwise on a
  click). A link alone must never connect a signed-in member. Insider: `app/pages/i/[code].vue`.
- **Shared storage (production):** the counters and the withdraw cooldown live on `st8-social-rate-limit`; mount a
  shared driver there (st8-social's README) or they count per serverless instance.

## API

| Route | What it does |
|---|---|
| `GET /api/connections` | The member's network: `connections` (ranked, with mutual counts and scores), `incoming`, `outgoing`, `blocked` |
| `POST /api/connections` | `{ user }`: ask to connect. Asking someone who asked you (even one you declined) connects you |
| `PATCH /api/connections/[user]` | `{ action: accept \| decline \| cancel \| remove }` |
| `PUT /api/connections/blocks` | `{ user, blocked }` |
| `POST /api/connections/intro` | `{ a, b, note? }`: introduce two of your connections |
| `GET /api/connections/mutuals?user=` | The connections you share with someone (never anyone's whole network) |
| `GET /api/invites` | Your live link (made on first use) |
| `POST /api/invites/reset` | End your link now, make a new one |
| `GET /api/invites/[code]` | Public: the inviter's name, photo and work, or `expired` / `unknown`; signed in, also your state |
| `POST /api/invites/redeem` | `{ code }`: connect with the inviter now |

## Behaviour

| | |
|---|---|
| **States** | `none`, `outgoing`, `incoming`, `connected`, `blocked` (you blocked them). Being blocked is never reported: it reads as "no such member" (404) everywhere. |
| **Request** | Only to active members of this app, not yourself, not across a block. Duplicates are no-ops. Crossing requests (or parallel ones both ways) end as one accepted edge. 20 a day, at most 100 open. |
| **Decline** | Quiet: the sender isn't told, keeps seeing "requested", and can't read the declined row. Asking again stays quiet. The decliner can still ask them later (that connects them: the other had asked). |
| **Withdraw** | Deletes the request and its unread notification. Asking the same person again waits `withdrawCooldownDays`. |
| **Remove** | Either person; deletes the edge; nobody is told. |
| **Block** | From any state, by either person. The pair's edge is replaced by one `blocked` row, requester = blocker (a new row, so the other side's live views see the old one deleted), and unread connection notifications between them are withdrawn. Hidden both ways: requests, invites, intros and mutuals across it are 404s; st8-social hides comments, reactions and mentions; hosts drop blocked people from profiles and lists (`st8SocialServer.blockedWith`). Only the blocker can unblock, and that restores nothing. |
| **Intro** | Two of your accepted connections, both active members here, plus an optional note (≤300 characters, plain text). Both get an `intro` notification pointing at the other; no edge is made, so either can ask to connect or let it be. Already connected: 409. Blocked between them: reported as sent, nobody notified (a block is never revealed to a third person). The same intro by the same person within `introRepeatDays` is a no-op. 10 a day. |
| **Invites** | One live link per member per app, reusable by many people, valid `inviteDays`; reset ends it at once. Redeeming connects at once (sharing the link is the inviter's consent) and tells the inviter (`connection_accepted`, `via: invite`). Once per person per link (`invite_redemptions`): someone the inviter removed can't reconnect with it. Your own link: 400; expired: 410; unknown, inactive inviter or across a block: 404. |
| **Ranking** | `score = 0.5 · interaction + 0.3 · recency + 0.2 · mutuals`, each 0–1 across your connections. Interaction: replies (and comments on the other's item) 3, mentions 2, reactions 1 between the two people in this app, read from `notifications` (both directions, last 180 days, half-life 30 days, ≤3 points per pair per day), normalised by your highest pair. Recency: when you connected, half-life 60 days. Mutuals: log(1 + shared connections), normalised. The inner ring is the highest scores. |
| **Notifications** | `connection_request` (→ the requests inbox), `connection_accepted` (→ their profile; "through your invite link" for redemptions), `intro` (→ the other person's profile). Never to yourself, never across a block. Tagged with this app. |
| **Realtime** | `useConnections` subscribes to the member's own `connections` (their policy scopes it) and refetches the overview on any event; a resubscribe (reconnect, wake, tab return) refetches too. |
