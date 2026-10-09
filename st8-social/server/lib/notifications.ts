import { updateItems } from '@directus/sdk'
import type { NotificationPage, NotificationType, ReactionKey, SocialNotification, SocialPerson } from '../../shared/types/social'
import { type SocialContext, blockedWith, count, create, remove, rows, sys } from './core'
import { mentionIds } from '../../shared/utils/social'
import { resolvePeople } from './people'

// In-app notifications (the `notifications` collection, docs/go-live-plan.md §5). Written by the server account; a
// member reads only their own (ST8 Social: recipient = $CURRENT_USER), which is also what their realtime subscription
// sees. Each row carries what the bell needs to render it in `data`, so the list needs no lookups per row.

export interface NotificationData {
  /** reply: `comment` = a comment on your target, `reply` = a reply to your comment. */
  kind?: 'comment' | 'reply'
  /** The target's label ("event", "comment"). */
  label?: string
  snippet?: string | null
  /** The thread's target, for the link. */
  on?: { collection: string, item: string }
  comment?: string
  reaction?: ReactionKey
  action?: 'hide' | 'unhide' | 'remove' | 'auto_hide'
  /** Another member the notification is about (an intro: the person you were introduced to). Resolved for the list. */
  with?: string
  /** How it came about, for types registered by other layers (e.g. `invite` for a connection made by an invite link). */
  via?: string
}

export interface NotifyInput {
  recipient: string
  /** Null for system events (auto-hide) and moderator actions, which never name the moderator. */
  actor: string | null
  type: NotificationType
  target: { collection: string, item: string }
  data: NotificationData
}

/** A short, plain excerpt of a comment body: mentions as names, markdown markers dropped. */
export function snippetOf(body: string, people: Map<string, SocialPerson>, max = 140) {
  const text = body
    .replace(/<@([0-9a-f-]{36})>/gi, (_, id: string) => `@${people.get(id.toLowerCase())?.name ?? 'member'}`)
    .replace(/\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_])/g, (_, a, b, c, d) => a ?? b ?? c ?? d)
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text
}

/** snippetOf, resolving the body's mentions itself. */
export async function snippetFrom(body: string | null | undefined) {
  if (!body) return null
  return snippetOf(body, await resolvePeople(mentionIds(body)))
}

/**
 * Create notifications. Skips notifying yourself, and anyone on the other side of a block from the actor. Failures are
 * logged, never thrown: a notification must not undo the write that caused it.
 */
export async function notify(ctx: SocialContext | null, list: NotifyInput[]) {
  const seen = new Set<string>()
  for (const n of list) {
    const key = `${n.recipient}:${n.type}:${n.target.collection}:${n.target.item}`
    if (n.recipient === n.actor || seen.has(key)) continue
    seen.add(key)
    try {
      if (n.actor) {
        const blocked = ctx && ctx.me === n.actor ? ctx.blocked : await blockedWith(n.actor)
        if (blocked.includes(n.recipient)) continue
      }
      await create('notifications', {
        recipient: n.recipient,
        actor: n.actor,
        type: n.type,
        target_collection: n.target.collection,
        target_item: n.target.item,
        app: useSt8Social().app,
        data: n.data,
      }, ['id'])
    } catch (err) {
      console.error('[st8-social] notification not created:', n.type, directusError(err).message ?? err)
    }
  }
}

/**
 * Reactions notify once per person per target: switching reactions updates the unread notification, clearing the
 * reaction withdraws it.
 */
export async function notifyReaction(ctx: SocialContext, recipient: string, target: { collection: string, item: string }, reaction: ReactionKey | null, data: NotificationData) {
  if (recipient === ctx.me) return
  try {
    const existing = await rows<{ id: string, data: NotificationData | null }>(sys(), 'notifications', {
      fields: ['id', 'data'],
      filter: { recipient: { _eq: recipient }, actor: { _eq: ctx.me }, type: { _eq: 'reaction' }, target_collection: { _eq: target.collection }, target_item: { _eq: target.item }, read_at: { _null: true } },
      limit: 5,
    })
    if (!reaction) {
      for (const n of existing) await remove('notifications', n.id)
      return
    }
    if (existing[0]) {
      await sys().request(updateItems('notifications', [existing[0].id], { data: { ...existing[0].data, ...data, reaction } }))
      return
    }
    await notify(ctx, [{ recipient, actor: ctx.me, type: 'reaction', target, data: { ...data, reaction } }])
  } catch (err) {
    console.error('[st8-social] reaction notification failed:', directusError(err).message ?? err)
  }
}

export interface NotificationRow {
  id: string
  type: NotificationType
  actor: string | null
  target_collection: string
  target_item: string
  data: NotificationData | null
  read_at: string | null
  date_created: string
}

function textOf(n: NotificationRow, people: Map<string, SocialPerson>): string {
  const custom = notificationType(n.type)
  if (custom) return custom.text({ ...n, people })
  const d = n.data ?? {}
  const label = d.label ?? 'post'
  switch (n.type) {
    case 'reply':
      return d.kind === 'comment' ? `commented on your ${label}` : 'replied to your comment'
    case 'mention':
      return 'mentioned you in a comment'
    case 'reaction':
      return `reacted to your ${label}`
    case 'moderation':
      return {
        hide: 'A moderator hid your comment. Only you can see it now.',
        unhide: 'A moderator restored your comment.',
        remove: 'A moderator removed your comment.',
        auto_hide: 'Your comment was hidden after several reports, until a moderator reviews it.',
      }[d.action ?? 'hide']
    case 'connection_request':
      return 'wants to connect'
    case 'connection_accepted':
      return 'accepted your connection request'
    default:
      return 'sent you a notification'
  }
}

function linkOf(n: NotificationRow, people: Map<string, SocialPerson>): string | null {
  const custom = notificationType(n.type)
  if (custom?.link) {
    try {
      return custom.link({ ...n, people })
    } catch {
      return null
    }
  }
  const on = n.data?.on ?? { collection: n.target_collection, item: n.target_item }
  const def = socialTarget(on.collection)
  try {
    return def?.link?.(on.item, { comment: n.data?.comment }) ?? null
  } catch {
    return null
  }
}

const unreadFilter = (me: string) => ({ recipient: { _eq: me }, read_at: { _null: true }, app: { _eq: useSt8Social().app } })

/** The viewer's notifications for this app, newest first, with the unread count. */
export async function listNotifications(ctx: SocialContext, opts: { before?: string, limit: number }): Promise<NotificationPage> {
  const filter: Record<string, unknown> = { recipient: { _eq: ctx.me }, app: { _eq: useSt8Social().app } }
  if (opts.before) filter.date_created = { _lt: opts.before }
  const [list, unread] = await Promise.all([
    rows<NotificationRow>(ctx.user, 'notifications', {
      fields: ['id', 'type', 'actor', 'target_collection', 'target_item', 'data', 'read_at', 'date_created'],
      filter,
      sort: ['-date_created'],
      limit: opts.limit + 1,
    }),
    count(ctx.user, 'notifications', unreadFilter(ctx.me)),
  ])
  const page = list.slice(0, opts.limit).filter((n) => !n.actor || !ctx.blocked.includes(n.actor))
  const people = await resolvePeople([...page.map((n) => n.actor), ...page.map((n) => n.data?.with)])
  const items: SocialNotification[] = page.map((n) => ({
    id: n.id,
    type: n.type,
    actor: n.actor ? (people.get(n.actor) ?? null) : null,
    text: textOf(n, people),
    snippet: n.data?.snippet ?? null,
    link: linkOf(n, people),
    reaction: n.data?.reaction ?? null,
    createdAt: n.date_created,
    read: !!n.read_at,
  }))
  return { items, unread, next: list.length > opts.limit ? (list[opts.limit - 1]?.date_created ?? null) : null }
}

/** Mark some (or all) of the viewer's notifications read. Returns the new unread count. */
export async function markRead(ctx: SocialContext, ids: string[] | 'all'): Promise<number> {
  const filter: Record<string, unknown> = unreadFilter(ctx.me)
  if (ids !== 'all') filter.id = { _in: ids }
  const unread = await rows<{ id: string }>(sys(), 'notifications', { fields: ['id'], filter, limit: 500 })
  if (unread.length) await sys().request(updateItems('notifications', unread.map((n) => n.id), { read_at: new Date().toISOString() }))
  return count(ctx.user, 'notifications', unreadFilter(ctx.me))
}

/**
 * Delete the unread notifications that match `filter` (e.g. a connection request that was withdrawn). Read ones stay:
 * the member has seen them. Never throws.
 */
export async function withdrawNotifications(filter: Record<string, unknown>) {
  try {
    const list = await rows<{ id: string }>(sys(), 'notifications', { fields: ['id'], filter: { ...filter, read_at: { _null: true } }, limit: 100 })
    for (const n of list) await remove('notifications', n.id)
  } catch (err) {
    console.error('[st8-social] notifications not withdrawn:', directusError(err).message ?? err)
  }
}

/** Mark the unread notifications that match `filter` read (e.g. a request the member answered). Never throws. */
export async function markNotificationsRead(filter: Record<string, unknown>) {
  try {
    const list = await rows<{ id: string }>(sys(), 'notifications', { fields: ['id'], filter: { ...filter, read_at: { _null: true } }, limit: 100 })
    if (list.length) await sys().request(updateItems('notifications', list.map((n) => n.id), { read_at: new Date().toISOString() }))
  } catch (err) {
    console.error('[st8-social] notifications not marked read:', directusError(err).message ?? err)
  }
}
