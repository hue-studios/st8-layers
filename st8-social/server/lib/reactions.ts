import type { ReactionCounts, ReactionKey, ReactionResult, SocialPerson } from '../../shared/types/social'
import { REACTION_KEYS, isReactionKey } from '../../shared/utils/social'
import { type SocialContext, type SocialEvent, and, byId, create, isUniqueViolation, notBlocked, one, remove, rows, socialRateLimit, sys, update, withLock } from './core'
import { recountComment, touchThread } from './counters'
import { notifyReaction, snippetFrom } from './notifications'
import { resolvePeople } from './people'
import { findThread, getOrCreateThread, requireTarget, summarizeOne } from './threads'

// Reactions: one per member per target, switchable (docs/go-live-plan.md §5). The unique key
// "<collection>:<item>:<user>" makes the set a single create-or-update and the clear a single delete; there is never a
// window with two rows for one person.

interface ReactionRow { id: string, reaction: ReactionKey }

/** Set, switch or clear (`reaction: null`) the viewer's reaction on a target. */
export async function setReaction(event: SocialEvent, ctx: SocialContext, input: { collection?: unknown, item?: unknown, reaction?: unknown }): Promise<ReactionResult> {
  await socialRateLimit(event, ctx.me, 'reactions', 'You’re reacting quickly.')
  const reaction = input.reaction ?? null
  if (reaction !== null && !isReactionKey(reaction)) throw createError({ statusCode: 400, message: `Reaction must be one of ${REACTION_KEYS.join(', ')}, or null.` })
  const { def, collection, item } = await requireTarget(event, ctx, input, 'reactions')
  const uniqueKey = `${collection}:${item}:${ctx.me}`

  const changed = await withLock(`reaction:${uniqueKey}`, async () => {
    const existing = await one<ReactionRow>(sys(), 'reactions', { fields: ['id', 'reaction'], filter: { unique_key: { _eq: uniqueKey } } })
    if (!reaction) {
      if (!existing) return false
      await remove('reactions', existing.id)
      return true
    }
    if (existing?.reaction === reaction) return false
    if (existing) {
      await update('reactions', existing.id, { reaction })
      return true
    }
    try {
      await create('reactions', { unique_key: uniqueKey, target_collection: collection, target_item: item, user: ctx.me, reaction }, ['id'])
    } catch (err) {
      // Another request from the same member created it first: switch that one instead.
      if (!isUniqueViolation(err)) throw err
      const row = await one<ReactionRow>(sys(), 'reactions', { fields: ['id', 'reaction'], filter: { unique_key: { _eq: uniqueKey } } })
      if (row && row.reaction !== reaction) await update('reactions', row.id, { reaction })
    }
    return true
  })

  if (collection === 'comments') {
    const comment = await byId<{ id: string, thread: string, author: string | null, body: string | null }>(sys(), 'comments', item, ['id', 'thread', 'author', 'body'])
    if (!comment) throw createError({ statusCode: 404, message: 'Not found' })
    if (changed) {
      await recountComment(item)
      await touchThread(comment.thread)
    }
    const t = await byId<{ target_collection: string, target_item: string }>(sys(), 'threads', comment.thread, ['target_collection', 'target_item'])
    if (changed && comment.author) {
      await notifyReaction(ctx, comment.author, { collection, item }, reaction as ReactionKey | null, {
        label: def.label,
        on: t ? { collection: t.target_collection, item: t.target_item } : undefined,
        comment: item,
        snippet: await snippetFrom(comment.body),
      })
    }
    const counts = await countsFor(ctx, collection, item)
    return { myReaction: reaction as ReactionKey | null, ...counts, thread: null }
  }

  if (changed) {
    const thread = reaction ? await getOrCreateThread(collection, item) : await findThread(collection, item)
    if (thread) await touchThread(thread.id)
    const owner = def.owners ? (await def.owners([item])).get(item) : undefined
    if (owner) await notifyReaction(ctx, owner, { collection, item }, reaction as ReactionKey | null, { label: def.label, on: { collection, item } })
  }
  const summary = await summarizeOne(event, ctx, collection, item)
  return { myReaction: summary.myReaction, reactions: summary.reactions, reactionTotal: summary.reactionTotal, thread: summary }
}

/** Reaction counts on a target as the viewer sees them (blocked members' reactions left out). */
async function countsFor(ctx: SocialContext, collection: string, item: string) {
  const list = await rows<{ reaction: ReactionKey }>(ctx.user, 'reactions', {
    fields: ['reaction'],
    filter: and({ target_collection: { _eq: collection }, target_item: { _eq: item } }, notBlocked('user', ctx.blocked)),
    limit: -1,
  })
  const reactions: ReactionCounts = {}
  for (const r of list) reactions[r.reaction] = (reactions[r.reaction] ?? 0) + 1
  return { reactions, reactionTotal: list.length }
}

/** Who reacted to a target, newest first (blocked members left out), with the counts. */
export async function listReactors(event: SocialEvent, ctx: SocialContext, input: { collection?: unknown, item?: unknown }) {
  const { collection, item } = await requireTarget(event, ctx, input, 'reactions')
  const list = await rows<{ user: string, reaction: ReactionKey, date_created: string }>(ctx.user, 'reactions', {
    fields: ['user', 'reaction', 'date_created'],
    filter: and({ target_collection: { _eq: collection }, target_item: { _eq: item } }, notBlocked('user', ctx.blocked)),
    sort: ['-date_created'],
    limit: 500,
  })
  const people = await resolvePeople(list.map((r) => r.user))
  const reactors = list
    .map((r) => ({ person: people.get(r.user), reaction: r.reaction }))
    .filter((r): r is { person: SocialPerson, reaction: ReactionKey } => !!r.person)
    .sort((a, b) => Number(b.person.id === ctx.me) - Number(a.person.id === ctx.me))
  const reactions: ReactionCounts = {}
  for (const r of reactors) reactions[r.reaction] = (reactions[r.reaction] ?? 0) + 1
  return { reactors, reactions, reactionTotal: reactors.length }
}
