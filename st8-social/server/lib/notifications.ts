import { updateItems } from '@directus/sdk'
import type { NotificationPage, NotificationType, ReactionKey, SocialNotification, SocialPerson } from '../../shared/types/social'
import { type SocialContext, blockedWith, count, create, remove, rows, sys } from './core'
import { mentionIds } from '../../shared/utils/social'
import { resolvePeople } from './people'
import { queuePush, pushConfig } from './push'
import type { PushMessage } from '../../shared/types/push'

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
  /**
   * moderation: what happened to the recipient's item (`clear`: their profile's content), their report (`report_*`),
   * or their membership (`unsuspend`).
   */
  action?: 'hide' | 'unhide' | 'remove' | 'auto_hide' | 'clear' | 'report_actioned' | 'report_dismissed' | 'unsuspend'
  /** report (to moderators): the target's first report, an automatic hide, or a referral to admins. */
  report?: 'first' | 'auto_hide' | 'refer'
  /** report: the first report's reason. */
  reason?: string
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
  const waits: Promise<void>[] = []
  for (const n of list) {
    const key = `${n.recipient}:${n.type}:${n.target.collection}:${n.target.item}`
    if (n.recipient === n.actor || seen.has(key)) continue
    seen.add(key)
    try {
      if (n.actor) {
        const blocked = ctx && ctx.me === n.actor ? ctx.blocked : await blockedWith(n.actor)
        if (blocked.includes(n.recipient)) continue
      }
      const row = await create<{ id: string }>('notifications', {
        recipient: n.recipient,
        actor: n.actor,
        type: n.type,
        target_collection: n.target.collection,
        target_item: n.target.item,
        app: useSt8Social().app,
        data: n.data,
      }, ['id'])
      if (pushable(n)) {
        const created: NotificationRow = { id: row.id, type: n.type, actor: n.actor, target_collection: n.target.collection, target_item: n.target.item, data: n.data, read_at: null, date_created: new Date().toISOString() }
        const wait = queuePush({ recipient: n.recipient, type: n.type }, () => pushMessage(n.recipient, created))
        if (wait) waits.push(wait)
      }
    } catch (err) {
      console.error('[st8-social] notification not created:', n.type, directusError(err).message ?? err)
    }
  }
  if (waits.length) await Promise.all(waits)
}

// ── Push (server/lib/push.ts sends) ────────────────────────────────────────────────────────────────────────────

/** Bell only: a reviewed report, a restored membership. Reactions aren't in the pushed types at all. */
const BELL_ONLY_ACTIONS = new Set(['report_actioned', 'report_dismissed', 'unsuspend'])

function pushable(n: NotifyInput) {
  return pushConfig().enabled && !(n.type === 'moderation' && BELL_ONLY_ACTIONS.has(n.data.action ?? ''))
}

/** Which earlier push this one replaces on the device: activity on the same item, the same person, the same report. */
function pushTag(n: NotificationRow) {
  const app = useSt8Social().app
  const on = n.data?.on ?? { collection: n.target_collection, item: n.target_item }
  switch (n.type) {
    case 'connection_request':
    case 'connection_accepted':
      return `${app}:person:${n.actor}`
    case 'intro':
      return `${app}:intro:${n.data?.with ?? n.actor}`
    case 'report':
    case 'moderation':
      return `${app}:${n.type}:${n.target_collection}:${n.target_item}`
    default:
      return `${app}:${on.collection}:${on.item}`
  }
}

/**
 * What the lock screen shows: the app's name, then the bell's sentence with the actor's name. Never the snippet; a
 * report's reason stays in the app.
 */
async function pushMessage(recipient: string, n: NotificationRow): Promise<PushMessage> {
  const row: NotificationRow = n.type === 'report' ? { ...n, data: { ...n.data, reason: undefined } } : n
  const [people, unread] = await Promise.all([
    resolvePeople([row.actor, row.data?.with]),
    count(sys(), 'notifications', { recipient: { _eq: recipient }, read_at: { _null: true }, app: { _eq: useSt8Social().app } }),
  ])
  const text = textOf(row, people)
  const name = row.actor ? people.get(row.actor)?.name : null
  const sentence = name ? `${name} ${text}` : `${text.charAt(0).toUpperCase()}${text.slice(1)}`
  const { icon, badge } = pushConfig()
  return {
    v: 1,
    id: row.id,
    title: useSt8Auth().appName,
    body: /[.!?]$/.test(sentence) ? sentence : `${sentence}.`,
    url: linkOf(row, people) ?? '/',
    tag: pushTag(row),
    count: unread,
    ...(icon ? { icon } : {}),
    ...(badge ? { badge } : {}),
    ts: Date.parse(row.date_created),
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
      // In a comment, or in the target itself (a post's body).
      return n.target_collection === 'comments' ? 'mentioned you in a comment' : `mentioned you in a ${label}`
    case 'reaction':
      return `reacted to your ${label}`
    case 'moderation': {
      const what = d.label ?? 'comment'
      return {
        hide: `A moderator hid your ${what}. Only you can see it now.`,
        unhide: `A moderator restored your ${what}.`,
        remove: `A moderator removed your ${what}.`,
        auto_hide: `Your ${what} was hidden after several reports, until a moderator reviews it.`,
        clear: `A moderator removed content from your ${what}.`,
        report_actioned: `A moderator reviewed the ${what} you reported and took action. Thank you.`,
        report_dismissed: `A moderator reviewed the ${what} you reported and left it up.`,
        unsuspend: `Your ${useSt8Auth().appName} membership is active again.`,
      }[d.action ?? 'hide']
    }
    case 'report': {
      const what = d.label ?? 'item'
      const reason = d.reason ? ` (${d.reason.replace(/_/g, ' ')})` : ''
      return {
        first: `A ${what} was reported${reason}. Review it in the moderation queue.`,
        auto_hide: `A ${what} was hidden after several reports. Review it in the moderation queue.`,
        refer: `A moderator referred a reported ${what} to the admins.`,
      }[d.report ?? 'first']
    }
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
  // Moderators: the queue, opened on the target. A reporter whose report led to action, and a restored member: nowhere.
  if (n.type === 'report') return `${useSt8Social().moderationPath}?target=${encodeURIComponent(`${n.target_collection}:${n.target_item}`)}`
  if (n.type === 'moderation' && (n.data?.action === 'report_actioned' || n.data?.action === 'unsuspend')) return null
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
