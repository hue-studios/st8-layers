import { aggregate } from '@directus/sdk'
import type { ModerationLogPage, ModerationSummary, QueueAction, QueueItem, QueuePage, QueuePreview, QueueReport, ReportReason, SocialPerson, SuspendedMember } from '../../shared/types/social'
import { MENTION_TOKEN, mentionIds, parseTargetKey } from '../../shared/utils/social'
import { type SocialContext, byId, isSocialId, requireModerator, rows, sys } from './core'
import { conflictWith, reportWeight, reporterFacts } from './moderation'
import { resolvePeople } from './people'
import { findThread, ownThread } from './threads'

// The moderation queue's reads (Phase 8): reported targets grouped with their reports, the log and the suspended
// members, for this app's moderators and admins only. Reports and the log are read with the server account after the
// moderator check: members' and moderators' Directus tokens can't read either, so the queue is the only way in.

type Loose = Record<string, unknown>

/** The viewer's role here, when it's a moderator role (and the membership is active), else null. */
export async function moderatorRole(ctx: SocialContext): Promise<string | null> {
  const m = await readMembership(ctx.me, useSt8Social().app)
  return m?.status === 'active' && useSt8Social().moderatorRoles.includes(m.role) ? m.role : null
}

/** Whether `viewerRole` may suspend (or restore) a member whose role here is `targetRole`. Admins: never, here. */
export function outranks(viewerRole: string | null, targetRole: string | null | undefined) {
  if (!viewerRole) return false
  if (targetRole === 'admin') return false
  if (targetRole === 'moderator') return viewerRole === 'admin'
  return true
}

export async function moderationSummary(ctx: SocialContext): Promise<ModerationSummary> {
  const m = await readMembership(ctx.me, useSt8Social().app)
  const role = m?.role ?? null
  if (m?.status !== 'active' || !useSt8Social().moderatorRoles.includes(m.role)) return { canModerate: false, role, pending: 0 }
  const groups = (await sys().request(aggregate('reports' as never, {
    aggregate: { count: '*' },
    groupBy: ['target_collection', 'target_item'],
    query: { filter: { app: { _eq: useSt8Social().app }, status: { _eq: 'pending' } }, limit: -1 },
  } as never))) as unknown[]
  return { canModerate: true, role, pending: groups.length }
}

// ── Targets as they are now ────────────────────────────────────────────────────────────────────────────────────

export interface TargetState {
  state: QueueItem['state']
  autoHidden: boolean
  owner: string | null
  locked: boolean
  /** Comments: the thread's target (lock acts on it). */
  on: { collection: string, item: string } | null
  link: string | null
}

/** A reported target's state, owner, lock and link now (server account). */
export async function inspectTarget(collection: string, item: string): Promise<TargetState> {
  const def = socialTarget(collection)
  if (collection === 'comments') {
    const c = isSocialId(item) ? await byId<{ status: string, author: string | null, hidden_by: string | null, thread: string }>(sys(), 'comments', item, ['status', 'author', 'hidden_by', 'thread']) : null
    const t = c ? await ownThread(c.thread) : null
    if (!c || !t) return { state: 'gone', autoHidden: false, owner: null, locked: false, on: null, link: null }
    const on = { collection: t.target_collection, item: t.target_item }
    return {
      state: c.status as TargetState['state'],
      autoHidden: c.status === 'hidden' && !c.hidden_by,
      owner: c.author,
      locked: !!t.locked,
      on,
      link: safeLink(on.collection, on.item, item),
    }
  }
  const thread = await findThread(collection, item)
  const locked = !!thread?.locked
  if (def?.moderate) {
    const s = await def.moderate.state(item)
    if (!s) return { state: 'gone', autoHidden: false, owner: null, locked, on: null, link: null }
    return { state: s.status, autoHidden: s.status === 'hidden' && !!s.autoHidden, owner: s.owner, locked, on: null, link: safeLink(collection, item) }
  }
  const owner = def?.owners ? ((await def.owners([item])).get(item) ?? null) : null
  return { state: 'live', autoHidden: false, owner, locked, on: null, link: safeLink(collection, item) }
}

function safeLink(collection: string, item: string, comment?: string) {
  try {
    return socialTarget(collection)?.link?.(item, { comment }) ?? null
  } catch {
    return null
  }
}

/** What the viewer may do with a target in this state (before the conflict rule). */
function actionsFor(collection: string, s: TargetState, pending: number, ownerMembership: QueueItem['ownerMembership'], viewerRole: string | null): QueueAction[] {
  const def = socialTarget(collection)
  const out: QueueAction[] = []
  const moderatable = collection === 'comments' || !!def?.moderate
  if (pending) out.push('dismiss')
  if (moderatable) {
    if (s.state === 'published') out.push('hide', 'remove')
    if (s.state === 'hidden') {
      if (s.autoHidden) out.push('hide')
      out.push('unhide', 'remove')
    }
  }
  if (def?.clear && s.state !== 'gone') out.push('clear')
  if ((collection === 'comments' ? !!s.on : !!def?.comments) && s.state !== 'gone') out.push(s.locked ? 'unlock' : 'lock')
  if (!moderatable && !def?.clear && pending) out.push('refer')
  if (s.owner && ownerMembership?.status === 'active' && outranks(viewerRole, ownerMembership.role)) out.push('suspend')
  return out
}

// ── Previews ───────────────────────────────────────────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** A snapshot reduced to a title, a text and a few facts. Mention tokens become names. */
function previewOf(snapshot: Loose | null, label: string, people: Map<string, SocialPerson>): QueuePreview | null {
  if (!snapshot) return null
  const named = (text: string | null) => text?.replace(MENTION_TOKEN, (_, id: string) => `@${people.get(id.toLowerCase())?.name ?? 'member'}`) ?? null
  const kind = str(snapshot.kind) ?? label
  const meta: string[] = []
  const push = (...values: unknown[]) => {
    for (const v of values) if (str(v)) meta.push(str(v)!)
  }
  switch (kind) {
    case 'post':
      push(snapshot.type, snapshot.link)
      if (Number(snapshot.images) > 0) meta.push(`${snapshot.images} image${Number(snapshot.images) === 1 ? '' : 's'}`)
      return { kind, title: str(snapshot.title), text: named(str(snapshot.body)), meta }
    case 'event':
      push([str(snapshot.date), str(snapshot.time)].filter(Boolean).join(' · '), snapshot.host, snapshot.location)
      return { kind, title: str(snapshot.title), text: null, meta }
    case 'profile':
      push(snapshot.headline, [str(snapshot.title), str(snapshot.company)].filter(Boolean).join(', '), snapshot.website, snapshot.linkedin)
      if (Array.isArray(snapshot.skills) && snapshot.skills.length) meta.push(snapshot.skills.join(', '))
      return { kind, title: str(snapshot.name), text: str(snapshot.bio), meta }
    case 'comment':
    default:
      return { kind, title: null, text: named(str(snapshot.body) ?? str(snapshot.text)), meta }
  }
}

// ── The queue ──────────────────────────────────────────────────────────────────────────────────────────────────

interface ReportRow {
  id: string
  target_collection: string
  target_item: string
  reporter: string | null
  reason: ReportReason
  details: string | null
  snapshot: Loose | null
  status: 'pending' | 'actioned' | 'dismissed'
  action: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  date_created: string
}

const REPORT_FIELDS = ['id', 'target_collection', 'target_item', 'reporter', 'reason', 'details', 'snapshot', 'status', 'action', 'reviewed_by', 'reviewed_at', 'date_created']
const REVIEWED_GROUPS = 30

/**
 * `tab=pending`: every target with pending reports, automatically hidden ones first, then the most recently reported.
 * `tab=reviewed`: targets whose reports were reviewed, most recent first, in pages (`before` = a reviewed_at cursor).
 * `target=<collection>:<item>`: that one target with all of its reports (a notification's link), even with none.
 */
export async function readQueue(ctx: SocialContext, opts: { tab: 'pending' | 'reviewed', target?: string, before?: string }): Promise<QueuePage> {
  await requireModerator(ctx)
  const app = useSt8Social().app
  let list: ReportRow[]
  let next: string | null = null
  let only: { collection: string, item: string } | null = null

  if (opts.target) {
    only = parseTargetKey(opts.target)
    if (!only || !socialTarget(only.collection) || only.item.length > 64) throw createError({ statusCode: 400, message: 'Unknown target.' })
    list = await rows<ReportRow>(sys(), 'reports', { fields: REPORT_FIELDS, filter: { app: { _eq: app }, target_collection: { _eq: only.collection }, target_item: { _eq: only.item } }, sort: ['-date_created'], limit: 200 })
  } else if (opts.tab === 'pending') {
    list = await rows<ReportRow>(sys(), 'reports', { fields: REPORT_FIELDS, filter: { app: { _eq: app }, status: { _eq: 'pending' } }, sort: ['-date_created'], limit: 2000 })
  } else {
    const filter: Loose = { app: { _eq: app }, status: { _in: ['actioned', 'dismissed'] } }
    if (opts.before) filter.reviewed_at = { _lt: opts.before }
    list = await rows<ReportRow>(sys(), 'reports', { fields: REPORT_FIELDS, filter, sort: ['-reviewed_at', '-date_created'], limit: 400 })
  }

  // Group by target, keeping the order of first appearance.
  const groups = new Map<string, ReportRow[]>()
  for (const r of list) {
    const key = `${r.target_collection}:${r.target_item}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  if (only && !groups.size) groups.set(`${only.collection}:${only.item}`, [])
  let keys = [...groups.keys()]
  if (!only && opts.tab === 'reviewed') {
    if (keys.length > REVIEWED_GROUPS) {
      keys = keys.slice(0, REVIEWED_GROUPS)
      next = groups.get(keys.at(-1)!)!.at(-1)!.reviewed_at
    }
  }

  const items = await buildItems(ctx, keys.map((key) => ({ key, reports: groups.get(key)! })))
  if (!only && opts.tab === 'pending') items.sort((a, b) => Number(b.autoHidden) - Number(a.autoHidden) || b.lastAt.localeCompare(a.lastAt))
  return { items, next }
}

async function buildItems(ctx: SocialContext, groups: { key: string, reports: ReportRow[] }[]): Promise<QueueItem[]> {
  const viewerRole = await moderatorRole(ctx)
  const states = await Promise.all(groups.map(({ key }) => {
    const { collection, item } = parseTargetKey(key)!
    return inspectTarget(collection, item)
  }))
  const owners = [...new Set(states.map((s) => s.owner).filter((id): id is string => !!id))]
  const reporters = groups.flatMap((g) => g.reports.map((r) => r.reporter)).filter((id): id is string => !!id)
  const reviewers = groups.flatMap((g) => g.reports.map((r) => r.reviewed_by)).filter((id): id is string => !!id)
  const snapshots = groups.map((g) => g.reports[0]?.snapshot ?? null)
  const mentioned = snapshots.flatMap((s) => (typeof s?.body === 'string' ? mentionIds(s.body) : []))
  const [people, facts, memberships] = await Promise.all([
    resolvePeople([...owners, ...reporters, ...reviewers, ...mentioned]),
    reporterFacts(reporters),
    owners.length
      ? rows<{ user: string, role: string, status: 'active' | 'suspended' }>(sys(), 'memberships', { fields: ['user', 'role', 'status'], filter: { user: { _in: owners }, app: { _eq: useSt8Social().app } }, limit: -1 })
      : Promise.resolve([]),
  ])
  const membershipOf = new Map(memberships.map((m) => [String(m.user), { role: m.role, status: m.status }]))

  return groups.map(({ key, reports }, i) => {
    const { collection, item } = parseTargetKey(key)!
    const s = states[i]!
    const def = socialTarget(collection)
    const label = def?.label ?? collection
    const pending = reports.filter((r) => r.status === 'pending').length
    const ownerMembership = s.owner ? (membershipOf.get(s.owner) ?? null) : null
    const blocked = conflictWith(ctx, s.owner)
    const reviewed = reports.find((r) => r.status !== 'pending')
    const queueReports: QueueReport[] = reports.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: r.date_created,
      reporter: r.reporter ? (people.get(r.reporter) ?? null) : null,
      history: (r.reporter && facts.get(r.reporter)?.history) || { filed: 0, actioned: 0, dismissed: 0 },
      ...reportWeight(r.reporter, facts),
    }))
    const dates = reports.map((r) => r.date_created).sort()
    return {
      key,
      collection,
      item,
      label,
      state: s.state,
      autoHidden: s.autoHidden,
      locked: s.locked,
      owner: s.owner ? (people.get(s.owner) ?? null) : null,
      ownerMembership,
      preview: previewOf(snapshots[i] ?? null, label, people),
      link: s.link,
      reports: queueReports,
      pending,
      firstAt: dates[0] ?? new Date().toISOString(),
      lastAt: dates.at(-1) ?? new Date().toISOString(),
      review: reviewed && !pending
        ? { status: reviewed.status as 'actioned' | 'dismissed', action: reviewed.action, at: reviewed.reviewed_at, by: reviewed.reviewed_by ? (people.get(reviewed.reviewed_by) ?? null) : null }
        : null,
      actions: blocked ? [] : actionsFor(collection, s, pending, ownerMembership, viewerRole),
      blocked,
    }
  })
}

// ── The log ────────────────────────────────────────────────────────────────────────────────────────────────────

/** This app's moderation log, newest first, 50 a page. Moderators see who did what; nobody else reads it. */
export async function readLog(ctx: SocialContext, opts: { before?: string }): Promise<ModerationLogPage> {
  await requireModerator(ctx)
  const filter: Loose = { app: { _eq: useSt8Social().app } }
  if (opts.before) filter.date_created = { _lt: opts.before }
  const list = await rows<{ id: string, action: string, moderator: string | null, target_collection: string, target_item: string, target_author: string | null, reason: string | null, date_created: string }>(sys(), 'moderation_log', {
    fields: ['id', 'action', 'moderator', 'target_collection', 'target_item', 'target_author', 'reason', 'date_created'],
    filter,
    sort: ['-date_created'],
    limit: 51,
  })
  const page = list.slice(0, 50)
  const people = await resolvePeople(page.flatMap((e) => [e.moderator, e.target_author]))
  const path = useSt8Social().moderationPath
  return {
    items: page.map((e) => ({
      id: e.id,
      action: e.action,
      moderator: e.moderator ? (people.get(e.moderator) ?? null) : null,
      target: {
        collection: e.target_collection,
        item: e.target_item,
        label: socialTarget(e.target_collection)?.label ?? e.target_collection,
        link: e.action.endsWith('suspend_user') ? null : `${path}?target=${encodeURIComponent(`${e.target_collection}:${e.target_item}`)}`,
      },
      author: e.target_author ? (people.get(e.target_author) ?? null) : null,
      reason: e.reason,
      createdAt: e.date_created,
    })),
    next: list.length > 50 ? page.at(-1)!.date_created : null,
  }
}

// ── Suspended members ──────────────────────────────────────────────────────────────────────────────────────────

/** The latest `suspend_user` log entry per member (who, when, what was hidden with it). */
export async function suspensionEntries(users: string[]) {
  if (!users.length) return new Map<string, { moderator: string | null, date_created: string, snapshot: Loose | null }>()
  const list = await rows<{ target_item: string, moderator: string | null, date_created: string, snapshot: Loose | null }>(sys(), 'moderation_log', {
    fields: ['target_item', 'moderator', 'date_created', 'snapshot'],
    filter: { app: { _eq: useSt8Social().app }, action: { _eq: 'suspend_user' }, target_collection: { _eq: 'directus_users' }, target_item: { _in: users } },
    sort: ['-date_created'],
    limit: -1,
  })
  const out = new Map<string, { moderator: string | null, date_created: string, snapshot: Loose | null }>()
  for (const e of list) if (!out.has(e.target_item)) out.set(e.target_item, e)
  return out
}

/** Items hidden with a suspension, from its log entry: `{ comments: [...], in_posts: [...] }`. */
export function hiddenWith(snapshot: Loose | null | undefined): Record<string, string[]> {
  const hidden = snapshot?.hidden
  if (!hidden || typeof hidden !== 'object') return {}
  return Object.fromEntries(Object.entries(hidden as Record<string, unknown>).filter(([, ids]) => Array.isArray(ids)).map(([c, ids]) => [c, (ids as unknown[]).map(String)]))
}

export async function readSuspended(ctx: SocialContext): Promise<SuspendedMember[]> {
  await requireModerator(ctx)
  const viewerRole = await moderatorRole(ctx)
  const list = await rows<{ user: string, role: string, suspended_until: string | null, suspended_reason: string | null, date_updated: string | null }>(sys(), 'memberships', {
    fields: ['user', 'role', 'suspended_until', 'suspended_reason', 'date_updated'],
    filter: { app: { _eq: useSt8Social().app }, status: { _eq: 'suspended' } },
    sort: ['-date_updated'],
    limit: 500,
  })
  const ids = list.map((m) => String(m.user))
  const entries = await suspensionEntries(ids)
  const people = await resolvePeople([...ids, ...[...entries.values()].map((e) => e.moderator)])
  return list.flatMap((m) => {
    const person = people.get(String(m.user))
    if (!person) return []
    const entry = entries.get(String(m.user))
    return [{
      person,
      role: m.role,
      until: m.suspended_until,
      reason: m.suspended_reason,
      since: entry?.date_created ?? m.date_updated,
      by: entry?.moderator ? (people.get(entry.moderator) ?? null) : null,
      hidden: Object.values(hiddenWith(entry?.snapshot)).reduce((n, ids) => n + ids.length, 0),
      canRestore: m.user !== ctx.me && outranks(viewerRole, m.role),
    }]
  })
}
