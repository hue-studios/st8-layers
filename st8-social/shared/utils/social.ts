import type { ReactionKey, ReportReason } from '../types/social'

// Rules shared by the st8-social server and components (docs/go-live-plan.md §5).

export interface ReactionDef {
  key: ReactionKey
  label: string
  /** Fluent Emoji Flat glyph shown in the picker and summaries. */
  glyph: string
}

/** The reaction set, in picker order. `like` is the single-tap default. */
export const REACTIONS: readonly ReactionDef[] = [
  { key: 'like', label: 'Like', glyph: 'fluent-emoji-flat:thumbs-up' },
  { key: 'celebrate', label: 'Celebrate', glyph: 'fluent-emoji-flat:party-popper' },
  { key: 'support', label: 'Support', glyph: 'fluent-emoji-flat:handshake' },
  { key: 'insightful', label: 'Insightful', glyph: 'fluent-emoji-flat:light-bulb' },
  { key: 'love', label: 'Love', glyph: 'fluent-emoji-flat:red-heart' },
  { key: 'curious', label: 'Curious', glyph: 'fluent-emoji-flat:thinking-face' },
]

export const REACTION_KEYS = REACTIONS.map((r) => r.key)

export const isReactionKey = (value: unknown): value is ReactionKey => typeof value === 'string' && (REACTION_KEYS as string[]).includes(value)

export const reactionDef = (key: ReactionKey) => REACTIONS.find((r) => r.key === key)!

export const REPORT_REASONS: readonly { key: ReportReason, label: string, hint: string }[] = [
  { key: 'spam', label: 'Spam', hint: 'Advertising, scams or repeated posts' },
  { key: 'harassment', label: 'Harassment', hint: 'Targets or bullies someone' },
  { key: 'hate', label: 'Hate', hint: 'Attacks people for who they are' },
  { key: 'inappropriate', label: 'Inappropriate', hint: 'Explicit, violent or otherwise unsuitable' },
  { key: 'misinformation', label: 'Misinformation', hint: 'False or misleading claims' },
  { key: 'off_topic', label: 'Off topic', hint: 'Not relevant here' },
  { key: 'other', label: 'Something else', hint: 'Tell us in the details' },
]

export const isReportReason = (value: unknown): value is ReportReason => REPORT_REASONS.some((r) => r.key === value)

export const COMMENT_MAX = 2000
export const REPORT_DETAILS_MAX = 1000
export const MENTIONS_MAX = 20
/** Rendered depth: 0, 1, 2. Deeper replies attach at 2 with "↪ @name". */
export const MAX_DEPTH = 2
/** Replies shown per group before "View N more replies". */
export const REPLIES_SHOWN = 2

/** `<@uuid>` marks a mention in a stored body. */
export const MENTION_TOKEN = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi

/** The user ids a body mentions, in order, without repeats. */
export function mentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_TOKEN)].map((m) => m[1]!.toLowerCase()))]
}

/**
 * A comment body as stored: trimmed, \r\n → \n, no control characters, trailing spaces dropped, at most one blank line
 * in a row. Returns '' when nothing is left.
 */
export function normalizeCommentBody(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Visible length of a body: a mention token counts as a short name would. */
export const bodyLength = (body: string) => body.replace(MENTION_TOKEN, '@mention').length

export const targetKey = (collection: string, item: string | number) => `${collection}:${item}`

export function parseTargetKey(key: string): { collection: string, item: string } | null {
  const i = key.indexOf(':')
  if (i < 1 || i === key.length - 1) return null
  return { collection: key.slice(0, i), item: key.slice(i + 1) }
}

/** "Jen Ortiz" → "JO". */
export function personInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?'
}

/** The reaction keys with a count, most used first (ties in picker order). */
export function topReactions(counts: Partial<Record<ReactionKey, number>>, limit = 3): ReactionKey[] {
  return REACTION_KEYS.filter((k) => (counts[k] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || REACTION_KEYS.indexOf(a) - REACTION_KEYS.indexOf(b))
    .slice(0, limit)
}

/** Reaction counts with `delta` added to `key`, zero and negative counts dropped. */
export function bumpReaction(counts: Partial<Record<ReactionKey, number>>, key: ReactionKey, delta: number): Partial<Record<ReactionKey, number>> {
  const next = { ...counts, [key]: (counts[key] ?? 0) + delta }
  return Object.fromEntries(Object.entries(next).filter(([, n]) => (n ?? 0) > 0))
}
