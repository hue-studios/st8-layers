// The st8-social layer's public server API: its config and the target registry the host fills in (README.md, "Contract
// with the host app"). Everything else lives in server/lib and isn't auto-imported.

type SocialEventArg = Parameters<typeof getRequestIP>[0]

/** The layer's runtime config with its defaults (nuxt.config.ts documents each key). */
export function useSt8Social() {
  const social = (useRuntimeConfig().st8Social ?? {}) as Partial<{
    moderatorRoles: string[]
    editWindowMinutes: number
    autoHideReports: number
    teaserThreshold: number
    blockMemoSeconds: number
    autoHide: Partial<{ memberHours: number, historyDays: number, unreliableDismissed: number, unreliableActionedRatio: number }>
    limits: Record<string, number[]>
  }>
  const autoHide = social.autoHide ?? {}
  return {
    /** The ST8 app this server is (st8-auth's `st8Auth.app`). */
    app: useSt8Auth().app,
    moderatorRoles: social.moderatorRoles?.length ? social.moderatorRoles : ['moderator', 'admin'],
    editWindowMs: (social.editWindowMinutes ?? 15) * 60_000,
    autoHideReports: social.autoHideReports ?? 3,
    teaserThreshold: Math.max(social.teaserThreshold ?? 3, 1),
    blockMemoSeconds: Math.max(Number(social.blockMemoSeconds ?? 5), 0),
    /**
     * Which pending reports count toward the auto-hide (they all reach the queue): from members who joined this app at
     * least `memberHours` ago and whose record over `historyDays` isn't mostly dismissed (`unreliableDismissed` or more
     * dismissed and under `unreliableActionedRatio` of their reviewed reports actioned).
     */
    autoHide: {
      memberHours: autoHide.memberHours ?? 24,
      historyDays: autoHide.historyDays ?? 90,
      unreliableDismissed: autoHide.unreliableDismissed ?? 5,
      unreliableActionedRatio: autoHide.unreliableActionedRatio ?? 0.2,
    },
    limits: {
      comments: [10, 60],
      reactions: [60, 60],
      reports: [20, 3600],
      reportsDaily: [50, 86400],
      moderation: [120, 3600],
      suspensions: [20, 86400],
      teasers: [60, 60],
      ...social.limits,
    } as Record<'comments' | 'reactions' | 'reports' | 'reportsDaily' | 'moderation' | 'suspensions' | 'teasers', [number, number]>,
    /** The host's moderation queue page (links in moderators' notifications). */
    moderationPath: String((useRuntimeConfig().public.st8Social as { moderationPath?: string } | undefined)?.moderationPath || '/moderation'),
  }
}

export interface SocialTargetContext {
  event: SocialEventArg
  /** The signed-in member's id. */
  viewer: string
}

/**
 * Something members can react to, comment on or report. The host registers one per collection from a Nitro plugin
 * (`registerSocialTarget`); the layer registers `comments` itself. Nothing is reactable, commentable or reportable
 * until it is registered.
 */
export interface SocialTargetDefinition {
  /** The Directus collection, stored in `target_collection` (e.g. `events`, `in_posts`, `directus_users`). */
  collection: string
  /** What members call it, singular: "event", "post", "profile". Used in notifications and reports. */
  label: string
  comments?: boolean
  reactions?: boolean
  reports?: boolean
  /**
   * Which of `items` the viewer may see. Called for every read and write, batched (one call per collection per
   * request), so it should be one query. Anything not returned is a 404 to the caller.
   */
  visible: (items: string[], ctx: SocialTargetContext) => Promise<Set<string>> | Set<string>
  /**
   * The member who owns each item, if any. Owners are notified of comments and reactions on their items and can't
   * report their own.
   */
  owners?: (items: string[]) => Promise<Map<string, string>> | Map<string, string>
  /** What a report keeps of the item (text, author), so the report survives later edits and deletion. */
  snapshot?: (item: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null
  /** The in-app path that shows the item; `comment` asks for that comment to be opened. Null = no page. */
  link?: (item: string, opts: { comment?: string }) => string | null
  /**
   * Moderation of the item itself (comments are moderated by the layer). With it, moderators can hide, unhide and
   * remove the item through `POST /api/social/targets/moderate`, and `autoHideReports` distinct pending reports hide it.
   * The layer checks the transition, logs it (with `snapshot`), closes pending reports, tells the owner (never who did
   * it) and bumps the thread version so open views refetch; the host only changes its own row.
   */
  moderate?: SocialTargetModeration
  /**
   * Clear what the owner wrote on the item while keeping the item (a profile's headline, bio, links and photo). With it,
   * the moderation queue offers "Clear content" (logged as `clear_profile`, the owner told, never by whom).
   */
  clear?: (item: string) => Promise<void>
  /**
   * The owner's published items (needs `moderate`). With it, suspending a member can also hide everything they posted
   * here, and restoring them can bring it back.
   */
  ownedBy?: (user: string) => Promise<string[]>
}

export type SocialModerationAction = 'hide' | 'unhide' | 'remove'

export interface SocialTargetModeration {
  /** The item's moderation state now, or null when it doesn't exist. `autoHidden`: hidden by reports, not a person. */
  state: (item: string) => Promise<{ status: 'published' | 'hidden' | 'removed', owner: string | null, autoHidden?: boolean } | null>
  /**
   * Apply the action to the host's row. `moderator` is null for an automatic hide. For `remove` the host should clear
   * the content (a tombstone) and delete what only the item used (files). A `hide` of an item reports already hid
   * records the moderator who confirmed it.
   */
  apply: (item: string, action: SocialModerationAction, info: { moderator: string | null, reason: string | null }) => Promise<void>
}

const registry = new Map<string, SocialTargetDefinition>()

/** Register (or replace) a social target. Call it from a Nitro plugin in the host app. */
export function registerSocialTarget(def: SocialTargetDefinition) {
  if (def.ownedBy && !def.moderate) throw new Error(`[st8-social] target "${def.collection}": ownedBy needs moderate`)
  if (!/^[a-z0-9_]+$/.test(def.collection)) throw new Error(`[st8-social] invalid target collection "${def.collection}"`)
  registry.set(def.collection, def)
}

/** Every registered target. */
export function socialTargets(): SocialTargetDefinition[] {
  return [...registry.values()]
}

/** The registered target for `collection`, or null. */
export function socialTarget(collection: unknown): SocialTargetDefinition | null {
  return typeof collection === 'string' ? (registry.get(collection) ?? null) : null
}

// ── Notification types from other layers ─────────────────────────────────────────────────────────────────────────

/** A notification row as a registered type sees it: the stored row plus the people it names, resolved. */
export interface NotificationView {
  type: string
  actor: string | null
  target_collection: string
  target_item: string
  data: { with?: string, via?: string, snippet?: string | null } | null
  /** The actor and `data.with`, by id. */
  people: Map<string, { id: string, name: string }>
}

/** How the bell words and links a notification type another layer writes (st8-network: connections and intros). */
export interface NotificationTypeDefinition {
  /** The sentence after the actor's name, e.g. "wants to connect". */
  text: (n: NotificationView) => string
  /** Where tapping it goes; null = nowhere. Default: the target's registered link. */
  link?: (n: NotificationView) => string | null
}

const notificationTypes = new Map<string, NotificationTypeDefinition>()

/** Register (or replace) how a notification type is shown. Call it from a Nitro plugin. */
export function registerNotificationType(type: string, def: NotificationTypeDefinition) {
  notificationTypes.set(type, def)
}

/** The registered definition for a notification type, or null (the layer's own wording applies). */
export function notificationType(type: string): NotificationTypeDefinition | null {
  return notificationTypes.get(type) ?? null
}
