// ST8 network layer: the global member graph (connections, requests, blocks, intros, invite links), shared by every
// ST8 app (docs/go-live-plan.md §4). Connections are global (one edge per pair across ST8); the notifications they send
// belong to the app the member acted in. It needs layers/st8-auth (session) and layers/st8-social (notifications,
// realtime, rate limits). The pages that show the network (an Orbit, a list, member search) are the host's. See
// README.md for the contract.
export default defineNuxtConfig({
  nitro: {
    // The withdraw cooldown (asking the same person again too soon). Connections are global across ST8, so on the
    // shared store it lives under the shared `st8:<env>:` prefix (st8-auth's mountSharedStore); memory per instance
    // until then.
    storage: {
      'st8-network-cooldown': { driver: 'memory' },
    },
  },

  runtimeConfig: {
    st8Network: {
      /** Per member (invite previews: per IP): [max, window in seconds]. */
      limits: {
        requests: [20, 86400],
        responses: [120, 3600],
        blocks: [30, 86400],
        intros: [10, 86400],
        redeems: [10, 3600],
        inviteResets: [5, 86400],
        search: [60, 60],
        invitePreview: [60, 60],
      },
      /** Open requests a member may have waiting at once. */
      maxOutgoing: 100,
      /** After withdrawing a request, how long before you can ask the same person again. */
      withdrawCooldownDays: 21,
      /** How long a personal invite link works. */
      inviteDays: 30,
      /** The same member introducing the same two people again within this window is a no-op. */
      introRepeatDays: 30,
      /** The Orbit ranking (README.md, "Ranking"). Weights are normalised; days are half-lives and windows. */
      ranking: {
        interaction: 0.5,
        recency: 0.3,
        mutuals: 0.2,
        interactionHalfLifeDays: 30,
        interactionWindowDays: 180,
        recencyHalfLifeDays: 60,
        dailyCap: 3,
      },
    },
    public: {
      st8Network: {
        /** The host's network page (requests inbox: `?tab=requests`). Notifications link here. */
        connectionsPath: '/connections',
        /** Invite links are `<public.appUrl><invitePath><code>`. */
        invitePath: '/i/',
        /** Cookie that carries an invite code through sign-up or sign-in (set only by a click on the landing). */
        inviteCookie: 'st8_invite',
      },
    },
  },
})
