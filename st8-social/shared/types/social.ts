// What the st8-social API returns to the browser. Directus rows never leave the server; these are built from them.

/** A reaction key. Stable: glyphs and labels can change without a data migration (shared/utils/social.ts). */
export type ReactionKey = 'like' | 'celebrate' | 'support' | 'insightful' | 'love' | 'curious'

export type ReactionCounts = Partial<Record<ReactionKey, number>>

/** Something the host registered as reactable, commentable or reportable, e.g. `events` / `"12"`. */
export interface SocialTargetRef {
  collection: string
  item: string
}

/** A member as the social components show them. Never includes an email. */
export interface SocialPerson {
  id: string
  name: string
  first_name: string | null
  last_name: string | null
  /** Directus file id. */
  avatar: string | null
  /** Accent (Insider: industry colour) for the avatar ring. */
  color: string | null
  title: string | null
}

/** One target's thread counts, as the viewer sees them (blocked members' activity is subtracted). */
export interface ThreadSummary {
  /** `collection:item` */
  key: string
  collection: string
  item: string
  /** threads.id, or null until the first comment or reaction creates it. */
  thread: string | null
  version: number
  locked: boolean
  commentCount: number
  reactions: ReactionCounts
  reactionTotal: number
  myReaction: ReactionKey | null
  /** Up to two people who reacted (the viewer first), for "Jen and 14 others". */
  reactors: SocialPerson[]
  /** What the host allows on this target. */
  can: { comment: boolean, react: boolean, report: boolean }
}

export type CommentStatus = 'published' | 'hidden' | 'removed' | 'deleted' | 'unavailable'

export interface SocialComment {
  id: string
  thread: string
  parent: string | null
  root: string | null
  /** 0 = top level; stored replies deeper than 2 render at depth 2. */
  depth: number
  /** The comment this one renders under: null at the top level, the root for depth 1, the depth-1 ancestor below. */
  group: string | null
  /** Set when this reply answers a comment deeper than its group ("↪ @name"). */
  replyTo: SocialPerson | null
  author: SocialPerson | null
  /** Body with mentions as `<@user-id>` tokens; empty for tombstones. */
  body: string
  /** The people the body mentions (resolved, so tokens can render as names). */
  mentions: SocialPerson[]
  /**
   * `unavailable` is a placeholder for a parent the viewer can't see (hidden, blocked) that still has visible replies.
   */
  status: CommentStatus
  /** Hidden by the auto-hide threshold rather than a person. */
  autoHidden: boolean
  createdAt: string
  editedAt: string | null
  replyCount: number
  reactions: ReactionCounts
  reactionTotal: number
  myReaction: ReactionKey | null
  mine: boolean
  can: { edit: boolean, delete: boolean, reply: boolean, react: boolean, report: boolean, moderate: boolean }
}

export interface SocialViewer {
  id: string
  canModerate: boolean
}

/** GET /api/social/threads/comments: a page of top-level comments with their newest replies. */
export interface ThreadPage {
  thread: ThreadSummary
  viewer: SocialViewer
  comments: SocialComment[]
  /** Visible comments per group (the key is the group's comment id; `top` is the top level). */
  groups: Record<string, number>
  /** Pass as `before` for the next (older) page of top-level comments; null when there are no more. */
  next: string | null
  /** Pass as `since` to the delta read. */
  cursor: string | null
}

/** GET /api/social/threads/comments?since=: what changed in the loaded part of a thread. */
export interface ThreadDelta {
  thread: ThreadSummary
  viewer: SocialViewer
  /** Comments created or updated since the cursor (in loaded subtrees, plus new top-level ones). */
  changed: SocialComment[]
  /** Every comment the viewer can still see in the loaded subtrees; anything else loaded is gone. */
  present: string[]
  groups: Record<string, number>
  cursor: string | null
}

export type NotificationType = 'reply' | 'mention' | 'reaction' | 'connection_request' | 'connection_accepted' | 'intro' | 'moderation' | 'report'

export interface SocialNotification {
  id: string
  type: NotificationType
  actor: SocialPerson | null
  /** Plain sentence, e.g. "replied to your comment". The bell prefixes the actor's name. */
  text: string
  snippet: string | null
  /** Where tapping it goes; null when the target has no page in this app. */
  link: string | null
  reaction: ReactionKey | null
  createdAt: string
  read: boolean
}

export interface NotificationPage {
  items: SocialNotification[]
  unread: number
  next: string | null
}

/** PUT /api/social/reactions */
export interface ReactionResult {
  myReaction: ReactionKey | null
  reactions: ReactionCounts
  reactionTotal: number
  /** The target's thread summary (null for comments, whose counts live on the comment). */
  thread: ThreadSummary | null
}

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'inappropriate' | 'misinformation' | 'off_topic' | 'other'

export type ModerationAction = 'hide' | 'unhide' | 'remove'

/**
 * An app whose activity this app shows as a cross-app teaser (`public.st8Social.teasers`). In `joinUrl` and `openUrl`,
 * `{via}` becomes `<this app>:<collection>:<item>` (the join flow records it on the new membership as `joined_via`),
 * `{collection}` and `{item}` the target.
 */
export interface SocialTeaserApp {
  app: string
  /** "the Summit app" */
  label: string
  /** Where someone without a membership there joins, e.g. `https://…/auth/register?via={via}`. */
  joinUrl: string
  /** Where a member there opens the same target; omitted = no link for members. */
  openUrl?: string
}

/** GET /api/social/teasers: another app's activity on a target. Counts and reaction keys only; never names or text. */
export interface SocialTeaser {
  app: string
  /** Distinct people commenting or reacting there (people blocked with the viewer left out). At least the threshold. */
  people: number
  comments: number
  /** The top reaction keys, most used first. */
  reactions: ReactionKey[]
  /** The viewer is an active member of that app. */
  member: boolean
}

// ── Moderation queue (Phase 8; moderators and admins only) ─────────────────────────────────────────────────────────

/** What a moderator can do from the queue; which ones apply depends on the target and its state. */
export type QueueAction = 'dismiss' | 'hide' | 'unhide' | 'remove' | 'lock' | 'unlock' | 'clear' | 'refer' | 'suspend'

/** GET /api/social/moderation/summary: whether the viewer moderates here, and how many targets wait. */
export interface ModerationSummary {
  canModerate: boolean
  role: 'member' | 'contributor' | 'moderator' | 'admin' | null
  /** Targets with pending reports. */
  pending: number
}

export interface QueueReport {
  id: string
  reason: ReportReason
  details: string | null
  status: 'pending' | 'actioned' | 'dismissed'
  createdAt: string
  /** Null when the reporter's account is gone. */
  reporter: SocialPerson | null
  /** The reporter's reports over the auto-hide history window. */
  history: { filed: number, actioned: number, dismissed: number }
  /** Whether it counts toward the auto-hide; `why` says why not ("New member", "Often dismissed"). */
  counts: boolean
  why: string | null
}

/** The reported thing as it was reported (its snapshot), reduced to what the queue shows. */
export interface QueuePreview {
  kind: string
  title: string | null
  text: string | null
  /** Short facts: "3 images", "Fri, Oct 10 · 6:00 pm", a link. */
  meta: string[]
}

/** One reported target, with its reports. */
export interface QueueItem {
  key: string
  collection: string
  item: string
  /** "comment", "post", "event", "profile" */
  label: string
  /** Its state now: `gone` when it no longer exists, `live` for targets this app can't hide (events). */
  state: 'published' | 'hidden' | 'removed' | 'deleted' | 'gone' | 'live'
  autoHidden: boolean
  /** Comments on it (or, for a comment, on its thread) are closed. */
  locked: boolean
  owner: SocialPerson | null
  /** The owner's membership here, for the suspend action. */
  ownerMembership: { role: string, status: 'active' | 'suspended' } | null
  preview: QueuePreview | null
  link: string | null
  reports: QueueReport[]
  pending: number
  firstAt: string
  lastAt: string
  /** The last review (Reviewed tab). */
  review: { status: 'actioned' | 'dismissed', action: string | null, at: string | null, by: SocialPerson | null } | null
  /** What this viewer may do now; empty with `blocked` saying why (their own, a block, rank). */
  actions: QueueAction[]
  blocked: string | null
}

export interface QueuePage {
  items: QueueItem[]
  /** Cursor for the next page (Reviewed tab), or null. */
  next: string | null
}

export interface ModerationLogEntry {
  id: string
  action: string
  /** Null = automatic (reports, or a suspension that ran out). */
  moderator: SocialPerson | null
  target: { collection: string, item: string, label: string, link: string | null }
  author: SocialPerson | null
  reason: string | null
  createdAt: string
}

export interface ModerationLogPage {
  items: ModerationLogEntry[]
  next: string | null
}

export interface SuspendedMember {
  person: SocialPerson
  role: string
  until: string | null
  reason: string | null
  /** When and by whom (null = unknown, e.g. made directly in Directus before Phase 8). */
  since: string | null
  by: SocialPerson | null
  /** Posts and comments hidden with the suspension (restorable). */
  hidden: number
  /** Whether this viewer may restore them (rank). */
  canRestore: boolean
}
