import type { ReactionCounts } from '../../shared/types/social'
import { byId, count, countBy, sys, update, withLock } from './core'

// Denormalised counters (docs/go-live-plan.md §5, "Counts are denormalised").
//
// Directus has no atomic increment, so counters are never incremented. Each write recounts from the source rows
// (reactions, comments) and stores the result, then recounts again: if a concurrent write changed the source in
// between, the stored value is rewritten until a recount matches what was stored. The last writer to finish has always
// verified the source after its own write, so the stored value converges on the true count, across instances too.
// withLock() only saves wasted rounds inside one instance.

const MAX_ROUNDS = 6

const sameCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}

/** This app's reactions on a target, per key. Reactions are per app, like threads. */
export function reactionCountsFor(collection: string, item: string): Promise<ReactionCounts> {
  return countBy(sys(), 'reactions', 'reaction', { app: { _eq: useSt8Social().app }, target_collection: { _eq: collection }, target_item: { _eq: item } })
}

interface ThreadRow { id: string, app: string | null, target_collection: string, target_item: string, version: number | null, locked: boolean | null, comment_count: number | null, reaction_counts: ReactionCounts | null }

export const THREAD_FIELDS = ['id', 'app', 'target_collection', 'target_item', 'version', 'locked', 'comment_count', 'reaction_counts']

async function threadCounts(t: ThreadRow) {
  const [comments, reactions] = await Promise.all([
    count(sys(), 'comments', { thread: { _eq: t.id }, status: { _eq: 'published' } }),
    reactionCountsFor(t.target_collection, t.target_item),
  ])
  return { comment_count: comments, reaction_counts: reactions }
}

/**
 * Recount a thread's comments and its target's reactions, bump `version` (the realtime signal) and `last_activity_at`.
 * Every social write ends here, so every change reaches subscribers as one version bump (or more).
 */
export function touchThread(threadId: string, extra: Record<string, unknown> = {}): Promise<ThreadRow> {
  return withLock(`thread:${threadId}`, async () => {
    let t = await byId<ThreadRow>(sys(), 'threads', threadId, THREAD_FIELDS)
    if (!t) throw createError({ statusCode: 404, message: 'Thread not found' })
    let patch: Record<string, unknown> = { ...extra, last_activity_at: new Date().toISOString() }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const counts = await threadCounts(t)
      const version = (t.version ?? 0) + 1
      t = { ...t, ...patch, ...counts, version } as ThreadRow
      await update('threads', threadId, { ...patch, ...counts, version })
      const check = await threadCounts(t)
      if (check.comment_count === counts.comment_count && sameCounts(check.reaction_counts, counts.reaction_counts)) return t
      patch = {}
    }
    console.warn('[st8-social] thread counters still moving after', MAX_ROUNDS, 'rounds:', threadId)
    return t
  })
}

interface CommentCounterRow { id: string, reply_count: number | null, reaction_counts: ReactionCounts | null }

/** Recount a comment's direct replies (any status: tombstones keep their place) and its reactions. */
export function recountComment(commentId: string): Promise<CommentCounterRow | null> {
  return withLock(`comment:${commentId}`, async () => {
    const counts = async () => {
      const [replies, reactions] = await Promise.all([
        count(sys(), 'comments', { parent: { _eq: commentId } }),
        reactionCountsFor('comments', commentId),
      ])
      return { reply_count: replies, reaction_counts: reactions }
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const next = await counts()
      try {
        await update('comments', commentId, next)
      } catch (err) {
        if (directusError(err).status === 403 || directusError(err).status === 404) return null // deleted meanwhile
        throw err
      }
      const check = await counts()
      if (check.reply_count === next.reply_count && sameCounts(check.reaction_counts, next.reaction_counts)) return { id: commentId, ...next }
    }
    return null
  })
}
