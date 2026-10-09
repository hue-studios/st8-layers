// The st8-social layer's public server API: its config and the target registry the host fills in (README.md, "Contract
// with the host app"). Everything else lives in server/lib and isn't auto-imported.

type SocialEventArg = Parameters<typeof getRequestIP>[0]

/** The layer's runtime config with its defaults (nuxt.config.ts documents each key). */
export function useSt8Social() {
  const social = (useRuntimeConfig().st8Social ?? {}) as Partial<{
    moderatorRoles: string[]
    editWindowMinutes: number
    autoHideReports: number
    limits: Record<string, number[]>
  }>
  return {
    /** The ST8 app this server is (st8-auth's `st8Auth.app`). */
    app: useSt8Auth().app,
    moderatorRoles: social.moderatorRoles?.length ? social.moderatorRoles : ['moderator', 'admin'],
    editWindowMs: (social.editWindowMinutes ?? 15) * 60_000,
    autoHideReports: social.autoHideReports ?? 3,
    limits: {
      comments: [10, 60],
      reactions: [60, 60],
      reports: [20, 3600],
      ...social.limits,
    } as Record<'comments' | 'reactions' | 'reports', [number, number]>,
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
}

const registry = new Map<string, SocialTargetDefinition>()

/** Register (or replace) a social target. Call it from a Nitro plugin in the host app. */
export function registerSocialTarget(def: SocialTargetDefinition) {
  if (!/^[a-z0-9_]+$/.test(def.collection)) throw new Error(`[st8-social] invalid target collection "${def.collection}"`)
  registry.set(def.collection, def)
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
