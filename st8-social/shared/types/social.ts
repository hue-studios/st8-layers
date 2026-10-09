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

export type NotificationType = 'reply' | 'mention' | 'reaction' | 'connection_request' | 'connection_accepted' | 'intro' | 'moderation'

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
