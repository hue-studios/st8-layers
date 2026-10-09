import type { CommentStatus, ReactionCounts, ReactionKey, SocialComment, SocialPerson, ThreadDelta, ThreadPage } from '../../shared/types/social'
import { COMMENT_MAX, MAX_DEPTH, MENTIONS_MAX, REPLIES_SHOWN, bodyLength, bumpReaction, mentionIds, normalizeCommentBody } from '../../shared/utils/social'
import { type SocialContext, type SocialEvent, and, byId, count, create, isSocialId, notBlocked, remove, requireModerator, rows, socialRateLimit, sys, update } from './core'
import { recountComment, touchThread } from './counters'
import { type NotifyInput, notify, snippetFrom, snippetOf } from './notifications'
import { mentionable, resolvePeople } from './people'
import { logModeration, resolveReports } from './moderation'
import { findThread, getOrCreateThread, ownThread, requireTarget, summarizeOne } from './threads'

// Comments (docs/go-live-plan.md §5). Reads go through the member's own token, so Directus decides visibility: others'
// hidden comments never come back, moderators see everything. Writes go through the server account after the checks
// here. Every write recounts and bumps the thread version, which is what realtime subscribers watch.

export const COMMENT_FIELDS = ['id', 'thread', 'parent', 'root', 'depth', 'author', 'body', 'mentions', 'status', 'hidden_by', 'hidden_reason', 'edited_at', 'reply_count', 'reaction_counts', 'date_created', 'date_updated']

export interface CommentRow {
  id: string
  thread: string
  parent: string | null
  root: string | null
  depth: number | null
  author: string | null
  body: string | null
  mentions: string[] | null
  status: Exclude<CommentStatus, 'unavailable'>
  hidden_by: string | null
  hidden_reason: string | null
  edited_at: string | null
  reply_count: number | null
  reaction_counts: ReactionCounts | null
  date_created: string
  date_updated: string | null
}

/** Structure only (ids and parents), read with the server account so groups resolve through comments the viewer can't see. */
interface Node { id: string, parent: string | null, root: string | null, depth: number | null, author?: string | null, date_created?: string }

const PAGE_MAX = 30
const GROUP_MAX = 200

const sum = (counts: ReactionCounts) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
const latest = (r: { date_created: string, date_updated: string | null }) => (r.date_updated && r.date_updated > r.date_created ? r.date_updated : r.date_created)

/** A `since` cursor: the newest timestamp seen, minus a margin for writes that committed out of order. */
function cursorOf(list: { date_created: string, date_updated: string | null }[], fallback: string | null): string | null {
  const newest = list.reduce<string | null>((max, r) => (!max || latest(r) > max ? latest(r) : max), null)
  if (!newest) return fallback
  return new Date(new Date(newest).getTime() - 10_000).toISOString()
}

/** The comment a reply renders under: the root for depth 1, the depth-1 ancestor below that. */
function groupOf(c: Node, nodes: Map<string, Node>): string | null {
  if (!c.depth) return null
  if (c.depth === 1) return c.root ?? c.parent
  let p = c.parent
  for (let guard = 0; p && guard < 64; guard++) {
    const node = nodes.get(p)
    if (!node) break
    if ((node.depth ?? 0) === 1) return node.id
    if ((node.depth ?? 0) === 0) return c.root
    p = node.parent
  }
  return c.root
}

async function structureOf(roots: string[]): Promise<Map<string, Node>> {
  if (!roots.length) return new Map()
  const list = await rows<Node>(sys(), 'comments', {
    fields: ['id', 'parent', 'root', 'depth', 'date_created'],
    filter: { _or: [{ id: { _in: roots } }, { root: { _in: roots } }] },
    limit: -1,
  })
  return new Map(list.map((n) => [n.id, n]))
}

interface ViewOptions {
  nodes: Map<string, Node>
  /** Authors of comments the viewer can see, for "↪ @name". */
  authors: Map<string, string | null>
  locked: boolean
}

/** Directus rows → what the viewer sees, with their own reactions and blocked members' reactions taken out. */
export async function toViews(ctx: SocialContext, list: CommentRow[], opts: ViewOptions): Promise<SocialComment[]> {
  if (!list.length) return []
  const ids = list.map((c) => c.id)
  const [isMod, mine, theirs] = await Promise.all([
    ctx.isModerator(),
    rows<{ target_item: string, reaction: ReactionKey }>(ctx.user, 'reactions', {
      fields: ['target_item', 'reaction'],
      filter: { app: { _eq: useSt8Social().app }, target_collection: { _eq: 'comments' }, target_item: { _in: ids }, user: { _eq: ctx.me } },
      limit: -1,
    }),
    ctx.blocked.length
      ? rows<{ target_item: string, reaction: ReactionKey }>(ctx.user, 'reactions', {
          fields: ['target_item', 'reaction'],
          filter: { app: { _eq: useSt8Social().app }, target_collection: { _eq: 'comments' }, target_item: { _in: ids }, user: { _in: ctx.blocked } },
          limit: -1,
        })
      : Promise.resolve([]),
  ])
  const myReaction = new Map(mine.map((r) => [r.target_item, r.reaction]))

  const replyToAuthor = new Map<string, string>()
  for (const c of list) {
    const group = groupOf(c, opts.nodes)
    if ((c.depth ?? 0) >= 2 && c.parent && c.parent !== group) {
      const author = opts.authors.get(c.parent)
      if (author && !ctx.blocked.includes(author)) replyToAuthor.set(c.id, author)
    }
  }
  const people = await resolvePeople([
    ...list.map((c) => c.author),
    ...replyToAuthor.values(),
    ...list.flatMap((c) => (Array.isArray(c.mentions) ? c.mentions : [])),
  ])
  const now = Date.now()
  const { editWindowMs } = useSt8Social()

  return list.map((c): SocialComment => {
    let reactions: ReactionCounts = { ...(c.reaction_counts ?? {}) }
    for (const r of theirs) if (r.target_item === c.id) reactions = bumpReaction(reactions, r.reaction, -1)
    const isMine = !!c.author && c.author === ctx.me
    const tombstone = c.status === 'removed' || c.status === 'deleted'
    const published = c.status === 'published'
    const replies = c.reply_count ?? 0
    return {
      id: c.id,
      thread: c.thread,
      parent: c.parent,
      root: c.root,
      depth: Math.min(c.depth ?? 0, MAX_DEPTH),
      group: groupOf(c, opts.nodes),
      replyTo: replyToAuthor.has(c.id) ? (people.get(replyToAuthor.get(c.id)!) ?? null) : null,
      author: tombstone || !c.author ? null : (people.get(c.author) ?? null),
      body: tombstone ? '' : (c.body ?? ''),
      mentions: tombstone ? [] : (Array.isArray(c.mentions) ? c.mentions : []).map((id) => people.get(id)).filter((p): p is SocialPerson => !!p),
      status: c.status,
      autoHidden: c.status === 'hidden' && !c.hidden_by,
      createdAt: c.date_created,
      editedAt: c.edited_at,
      replyCount: replies,
      reactions,
      reactionTotal: sum(reactions),
      myReaction: myReaction.get(c.id) ?? null,
      mine: isMine,
      can: {
        edit: isMine && published && (now - new Date(c.date_created).getTime() < editWindowMs || replies === 0),
        delete: isMine && (published || c.status === 'hidden'),
        reply: published && (!opts.locked || isMod),
        react: published,
        report: !isMine && published,
        moderate: isMod && (published || c.status === 'hidden'),
      },
    }
  })
}

/** Visible comments per group, from the comments the viewer can see. */
function groupTotals(visible: Node[], nodes: Map<string, Node>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const c of visible) {
    const group = groupOf(c, nodes)
    if (group) totals[group] = (totals[group] ?? 0) + 1
  }
  return totals
}

async function threadFor(event: SocialEvent, ctx: SocialContext, ref: { collection?: unknown, item?: unknown }) {
  const { def, collection, item } = await requireTarget(event, ctx, ref, 'comments')
  return { def, collection, item, thread: await findThread(collection, item) }
}

const topFilter = (ctx: SocialContext, threadId: string) => and({ thread: { _eq: threadId }, depth: { _eq: 0 } }, notBlocked('author', ctx.blocked))

/** A page of top-level comments (newest first) with the newest replies of each group. */
export async function readThreadPage(event: SocialEvent, ctx: SocialContext, ref: { collection?: unknown, item?: unknown }, opts: { before?: string, limit: number }): Promise<ThreadPage> {
  const { collection, item, thread } = await threadFor(event, ctx, ref)
  const summary = await summarizeOne(event, ctx, collection, item)
  const viewer = { id: ctx.me, canModerate: await ctx.isModerator() }
  if (!thread) return { thread: summary, viewer, comments: [], groups: { top: 0 }, next: null, cursor: null }

  const limit = Math.min(Math.max(opts.limit, 1), PAGE_MAX)
  const [top, topCount] = await Promise.all([
    rows<CommentRow>(ctx.user, 'comments', {
      fields: COMMENT_FIELDS,
      filter: and(topFilter(ctx, thread.id), opts.before ? { date_created: { _lt: opts.before } } : {}),
      sort: ['-date_created', '-id'],
      limit: limit + 1,
    }),
    count(ctx.user, 'comments', topFilter(ctx, thread.id)),
  ])
  const pageTop = top.slice(0, limit)
  const roots = pageTop.map((c) => c.id)
  const [replies, nodes] = roots.length
    ? await Promise.all([
        rows<CommentRow>(ctx.user, 'comments', { fields: COMMENT_FIELDS, filter: and({ thread: { _eq: thread.id }, root: { _in: roots } }, notBlocked('author', ctx.blocked)), sort: ['date_created'], limit: -1 }),
        structureOf(roots),
      ])
    : [[], new Map<string, Node>()]

  // Newest REPLIES_SHOWN per group.
  const byGroup = new Map<string, CommentRow[]>()
  for (const r of replies) {
    const g = groupOf(r, nodes)
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), r])
  }
  const shown = [...byGroup.values()].flatMap((list) => list.slice(-REPLIES_SHOWN))
  const authors = new Map([...pageTop, ...replies].map((c) => [c.id, c.author]))
  const comments = await toViews(ctx, [...pageTop, ...shown], { nodes, authors, locked: !!thread.locked })

  return {
    thread: summary,
    viewer,
    comments,
    groups: { top: topCount, ...groupTotals(replies, nodes) },
    next: top.length > limit ? (pageTop.at(-1)?.date_created ?? null) : null,
    cursor: opts.before ? null : cursorOf([...pageTop, ...replies], new Date(Date.now() - 10_000).toISOString()),
  }
}

/**
 * What changed since `since` in the loaded part of a thread (the subtrees of `roots`, plus new top-level comments),
 * and which loaded comments the viewer can still see. A hidden or deleted comment can't announce its own departure to
 * someone who can no longer read it, so `present` is how the client learns it's gone.
 */
export async function readThreadDelta(event: SocialEvent, ctx: SocialContext, ref: { collection?: unknown, item?: unknown }, opts: { since: string, roots: string[] }): Promise<ThreadDelta> {
  const { collection, item, thread } = await threadFor(event, ctx, ref)
  const summary = await summarizeOne(event, ctx, collection, item)
  const viewer = { id: ctx.me, canModerate: await ctx.isModerator() }
  if (!thread) return { thread: summary, viewer, changed: [], present: [], groups: { top: 0 }, cursor: opts.since }

  const roots = opts.roots.filter(isSocialId).slice(0, 100)
  const inLoaded = roots.length ? { _or: [{ depth: { _eq: 0 } }, { root: { _in: roots } }] } : { depth: { _eq: 0 } }
  const [changed, present, topCount] = await Promise.all([
    rows<CommentRow>(ctx.user, 'comments', {
      fields: COMMENT_FIELDS,
      filter: and(
        { thread: { _eq: thread.id } },
        { _or: [{ date_created: { _gte: opts.since } }, { date_updated: { _gte: opts.since } }] },
        inLoaded,
        notBlocked('author', ctx.blocked),
      ),
      sort: ['date_created'],
      limit: 300,
    }),
    roots.length
      ? rows<Node>(ctx.user, 'comments', {
          fields: ['id', 'parent', 'root', 'depth', 'author'],
          filter: and({ thread: { _eq: thread.id } }, { _or: [{ id: { _in: roots } }, { root: { _in: roots } }] }, notBlocked('author', ctx.blocked)),
          limit: -1,
        })
      : Promise.resolve([] as Node[]),
    count(ctx.user, 'comments', topFilter(ctx, thread.id)),
  ])
  const allRoots = [...new Set([...roots, ...changed.map((c) => (c.depth ? c.root : c.id)).filter((id): id is string => !!id)])]
  const nodes = await structureOf(allRoots)
  const authors = new Map<string, string | null>([...present.map((c) => [c.id, c.author ?? null] as const), ...changed.map((c) => [c.id, c.author] as const)])
  const replies = present.filter((c) => (c.depth ?? 0) > 0)
  return {
    thread: summary,
    viewer,
    changed: await toViews(ctx, changed, { nodes, authors, locked: !!thread.locked }),
    present: present.map((c) => c.id),
    groups: { top: topCount, ...groupTotals(replies, nodes) },
    cursor: cursorOf(changed, opts.since),
  }
}

/** All visible comments in one group (the replies under a top-level comment, or under a depth-1 reply). */
export async function readGroup(event: SocialEvent, ctx: SocialContext, groupId: string): Promise<{ comments: SocialComment[], total: number }> {
  if (!isSocialId(groupId)) throw createError({ statusCode: 404, message: 'Not found' })
  const head = await byId<CommentRow & { thread: string }>(ctx.user, 'comments', groupId, ['id', 'thread', 'root', 'depth', 'author'])
  if (!head || (head.author && ctx.blocked.includes(head.author))) throw createError({ statusCode: 404, message: 'Not found' })
  const thread = await ownThread(head.thread)
  if (!thread) throw createError({ statusCode: 404, message: 'Not found' })
  await requireTarget(event, ctx, { collection: thread.target_collection, item: thread.target_item }, 'comments')

  const root = head.depth ? head.root! : head.id
  const [list, nodes] = await Promise.all([
    rows<CommentRow>(ctx.user, 'comments', { fields: COMMENT_FIELDS, filter: and({ root: { _eq: root } }, notBlocked('author', ctx.blocked)), sort: ['date_created'], limit: -1 }),
    structureOf([root]),
  ])
  const members = list.filter((c) => groupOf(c, nodes) === groupId).slice(-GROUP_MAX)
  const authors = new Map(list.map((c) => [c.id, c.author]))
  return { comments: await toViews(ctx, members, { nodes, authors, locked: !!thread.locked }), total: members.length }
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Normalise and check a body and its mentions. Mentions must be people the author may mention (see people.ts). */
async function checkBody(ctx: SocialContext, raw: unknown) {
  const body = normalizeCommentBody(raw)
  if (!body) throw createError({ statusCode: 400, data: { field: 'body' }, message: 'Write something first.' })
  if (bodyLength(body) > COMMENT_MAX) throw createError({ statusCode: 400, data: { field: 'body' }, message: `Comments can be up to ${COMMENT_MAX} characters.` })
  const ids = mentionIds(body)
  if (ids.length > MENTIONS_MAX) throw createError({ statusCode: 400, data: { field: 'body' }, message: `You can mention up to ${MENTIONS_MAX} people.` })
  const allowed = await mentionable(ctx, ids)
  if (allowed.length !== ids.length) throw createError({ statusCode: 400, data: { field: 'body' }, message: 'One of the people you mentioned can’t be mentioned here.' })
  return { body: body.replace(/<@([0-9a-f-]{36})>/gi, (_, id: string) => `<@${id.toLowerCase()}>`), mentions: allowed }
}

async function readOwnComment(ctx: SocialContext, id: string) {
  if (!isSocialId(id)) throw createError({ statusCode: 404, message: 'Comment not found' })
  const c = await byId<CommentRow>(sys(), 'comments', id, COMMENT_FIELDS)
  // Someone else's comment is a 404 too: the route never confirms what it can't show.
  if (!c || c.author !== ctx.me) throw createError({ statusCode: 404, message: 'Comment not found' })
  return c
}

/** The comment's thread, which must be this app's: another app's comments are a 404 here, for authors and moderators alike. */
async function threadTargetOf(threadId: string) {
  const t = await ownThread(threadId)
  if (!t) throw createError({ statusCode: 404, message: 'Comment not found' })
  return t
}

async function viewOf(ctx: SocialContext, row: CommentRow, locked: boolean) {
  const root = row.depth ? row.root : row.id
  const nodes = await structureOf(root ? [root] : [])
  const parent = row.parent ? await byId<{ id: string, author: string | null }>(ctx.user, 'comments', row.parent, ['id', 'author']) : null
  const authors = new Map<string, string | null>(parent ? [[parent.id, parent.author]] : [])
  const [view] = await toViews(ctx, [row], { nodes, authors, locked })
  return view!
}

export async function createComment(event: SocialEvent, ctx: SocialContext, input: { collection?: unknown, item?: unknown, parent?: unknown, body?: unknown }) {
  await socialRateLimit(event, ctx.me, 'comments', 'You’re commenting quickly.')
  const { def, collection, item } = await requireTarget(event, ctx, input, 'comments')
  const { body, mentions } = await checkBody(ctx, input.body)
  const thread = await getOrCreateThread(collection, item)
  if (thread.locked && !(await ctx.isModerator())) throw createError({ statusCode: 403, message: 'Comments are closed.' })

  let parent: Pick<CommentRow, 'id' | 'thread' | 'root' | 'depth' | 'author' | 'status'> | null = null
  if (input.parent !== undefined && input.parent !== null) {
    parent = isSocialId(input.parent) ? await byId(ctx.user, 'comments', input.parent, ['id', 'thread', 'root', 'depth', 'author', 'status']) : null
    if (!parent || parent.thread !== thread.id || parent.status !== 'published' || (parent.author && ctx.blocked.includes(parent.author))) {
      throw createError({ statusCode: 404, message: 'That comment isn’t available to reply to.' })
    }
  }

  const row = await create<CommentRow>('comments', {
    thread: thread.id,
    parent: parent?.id ?? null,
    root: parent ? (parent.root ?? parent.id) : null,
    depth: parent ? Math.min((parent.depth ?? 0) + 1, MAX_DEPTH) : 0,
    author: ctx.me,
    body,
    mentions,
    status: 'published',
    reply_count: 0,
    reaction_counts: {},
  }, COMMENT_FIELDS)
  await Promise.all([parent ? recountComment(parent.id) : null, touchThread(thread.id)])

  // Notifications: the parent's author (a reply), or the target's owner (a comment), then everyone mentioned.
  const people = await resolvePeople(mentions)
  const data = { label: def.label, snippet: snippetOf(body, people), on: { collection, item }, comment: row.id }
  const target = { collection: 'comments', item: row.id }
  const list: NotifyInput[] = []
  const owner = !parent && def.owners ? (await def.owners([item])).get(item) : undefined
  if (parent?.author) list.push({ recipient: parent.author, actor: ctx.me, type: 'reply', target, data: { ...data, kind: 'reply' } })
  else if (owner) list.push({ recipient: owner, actor: ctx.me, type: 'reply', target, data: { ...data, kind: 'comment' } })
  for (const id of mentions) if (id !== parent?.author && id !== owner) list.push({ recipient: id, actor: ctx.me, type: 'mention', target, data })
  const [comment, summary] = await Promise.all([viewOf(ctx, row, !!thread.locked), summarizeOne(event, ctx, collection, item), notify(ctx, list)])
  return { comment, thread: summary }
}

export async function editComment(event: SocialEvent, ctx: SocialContext, id: string, input: { body?: unknown }) {
  await socialRateLimit(event, ctx.me, 'comments', 'You’re editing quickly.')
  const c = await readOwnComment(ctx, id)
  if (c.status !== 'published') throw createError({ statusCode: 409, message: 'This comment can’t be edited.' })
  const replies = await count(sys(), 'comments', { parent: { _eq: c.id } })
  const { editWindowMs } = useSt8Social()
  if (Date.now() - new Date(c.date_created).getTime() >= editWindowMs && replies > 0) {
    throw createError({ statusCode: 403, message: `Comments can be edited for ${Math.round(editWindowMs / 60_000)} minutes, or until someone replies.` })
  }
  const t = await threadTargetOf(c.thread)
  const { def } = await requireTarget(event, ctx, { collection: t.target_collection, item: t.target_item }, 'comments')
  const { body, mentions } = await checkBody(ctx, input.body)
  if (body === c.body) return { comment: await viewOf(ctx, c, !!t.locked) }

  const row = await update<CommentRow>('comments', c.id, { body, mentions, edited_at: new Date().toISOString() }, COMMENT_FIELDS)
  await touchThread(c.thread)
  const added = mentions.filter((m) => !(c.mentions ?? []).includes(m) && m !== ctx.me)
  if (added.length) {
    const people = await resolvePeople(added)
    const data = { label: def.label, snippet: snippetOf(body, people), on: { collection: t.target_collection, item: t.target_item }, comment: c.id }
    await notify(ctx, added.map((recipient) => ({ recipient, actor: ctx.me, type: 'mention' as const, target: { collection: 'comments', item: c.id }, data })))
  }
  return { comment: await viewOf(ctx, row, !!t.locked) }
}

/** Remove a comment row and what hangs off it (its reactions, notifications about it). Reports keep their snapshot. */
async function hardDelete(id: string) {
  const [reactions, notifications] = await Promise.all([
    rows<{ id: string }>(sys(), 'reactions', { fields: ['id'], filter: { target_collection: { _eq: 'comments' }, target_item: { _eq: id } }, limit: -1 }),
    rows<{ id: string }>(sys(), 'notifications', { fields: ['id'], filter: { target_collection: { _eq: 'comments' }, target_item: { _eq: id } }, limit: -1 }),
  ])
  for (const r of reactions) await remove('reactions', r.id)
  for (const n of notifications) await remove('notifications', n.id)
  await remove('comments', id)
}

/** Author delete: a hard delete without replies, a "[deleted]" tombstone with them. */
export async function deleteComment(event: SocialEvent, ctx: SocialContext, id: string) {
  const c = await readOwnComment(ctx, id)
  if (c.status === 'removed' || c.status === 'deleted') throw createError({ statusCode: 409, message: 'This comment is already gone.' })
  const t = await threadTargetOf(c.thread)
  const replies = await count(sys(), 'comments', { parent: { _eq: c.id } })
  let mode: 'hard' | 'tombstone' = 'tombstone'
  if (replies === 0) {
    mode = 'hard'
    await hardDelete(c.id)
    // A "[deleted]" parent that has just lost its last reply goes too, and so on up.
    let parentId = c.parent
    while (parentId) {
      const parent = await byId<CommentRow>(sys(), 'comments', parentId, ['id', 'parent', 'status'])
      if (!parent) break
      const left = await count(sys(), 'comments', { parent: { _eq: parent.id } })
      if (parent.status !== 'deleted' || left > 0) {
        await recountComment(parent.id)
        break
      }
      await hardDelete(parent.id)
      parentId = parent.parent
    }
  } else {
    await update('comments', c.id, { status: 'deleted', body: '', mentions: [] })
  }
  await touchThread(c.thread)
  return { mode, thread: await summarizeOne(event, ctx, t.target_collection, t.target_item).catch(() => null) }
}

export type ModerateAction = 'hide' | 'unhide' | 'remove'

/** Moderator hide / unhide / remove, logged, with the author told (never who did it). */
export async function moderateComment(event: SocialEvent, ctx: SocialContext, id: string, input: { action?: unknown, reason?: unknown }) {
  await requireModerator(ctx)
  const action = input.action as ModerateAction
  if (!['hide', 'unhide', 'remove'].includes(action)) throw createError({ statusCode: 400, message: 'Unknown action.' })
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) || null : null
  if (!isSocialId(id)) throw createError({ statusCode: 404, message: 'Comment not found' })
  const c = await byId<CommentRow>(sys(), 'comments', id, COMMENT_FIELDS)
  if (!c) throw createError({ statusCode: 404, message: 'Comment not found' })
  const t = await threadTargetOf(c.thread)
  const allowed = { hide: ['published'], unhide: ['hidden'], remove: ['published', 'hidden'] }[action]
  if (!allowed.includes(c.status)) throw createError({ statusCode: 409, message: `This comment is ${c.status}.` })

  const now = new Date().toISOString()
  const snapshot = { body: c.body, author: c.author, status: c.status, on: `${t.target_collection}:${t.target_item}` }
  const patch = {
    hide: { status: 'hidden', hidden_by: ctx.me, hidden_at: now, hidden_reason: reason },
    unhide: { status: 'published', hidden_by: null, hidden_at: null, hidden_reason: null },
    remove: { status: 'removed', body: '', mentions: [], hidden_by: ctx.me, hidden_at: now, hidden_reason: reason },
  }[action]
  const row = await update<CommentRow>('comments', c.id, patch, COMMENT_FIELDS)
  await logModeration({ moderator: ctx.me, action, target: { collection: 'comments', item: c.id }, targetAuthor: c.author, reason, snapshot })
  await resolveReports({ collection: 'comments', item: c.id }, ctx.me, action === 'unhide' ? { status: 'dismissed', action: 'none' } : { status: 'actioned', action })
  await touchThread(c.thread)
  if (c.author) {
    await notify(null, [{
      recipient: c.author,
      actor: null,
      type: 'moderation',
      target: { collection: 'comments', item: c.id },
      data: { action, label: 'comment', on: { collection: t.target_collection, item: t.target_item }, comment: c.id, snippet: action === 'unhide' ? null : await snippetFrom(c.body) },
    }])
  }
  return { comment: await viewOf(ctx, row, !!t.locked) }
}

/** Moderator lock / unlock: a locked thread takes no new comments (moderators excepted). */
export async function lockThread(event: SocialEvent, ctx: SocialContext, input: { collection?: unknown, item?: unknown, locked?: unknown }) {
  await requireModerator(ctx)
  if (typeof input.locked !== 'boolean') throw createError({ statusCode: 400, message: '`locked` must be true or false.' })
  const { collection, item } = await requireTarget(event, ctx, input, 'comments')
  const thread = await getOrCreateThread(collection, item)
  if (!!thread.locked !== input.locked) {
    await touchThread(thread.id, { locked: input.locked })
    await logModeration({ moderator: ctx.me, action: input.locked ? 'lock' : 'unlock', target: { collection, item }, targetAuthor: null, reason: null, snapshot: null })
  }
  return summarizeOne(event, ctx, collection, item)
}
