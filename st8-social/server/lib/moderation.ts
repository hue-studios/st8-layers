import { updateItems } from '@directus/sdk'
import { REPORT_DETAILS_MAX, isReportReason } from '../../shared/utils/social'
import { type SocialContext, type SocialEvent, byId, create, isUniqueViolation, readJson, requireModerator, rows, socialRateLimit, sys, update, withLock } from './core'
import { touchThread } from './counters'
import { markNotificationsRead, notify, snippetFrom } from './notifications'
import { getOrCreateThread, requireTarget, summarizeOne } from './threads'

// Reports, the moderation log and auto-hide (docs/go-live-plan.md §5, "Moderation"; Phase 8). Moderators work in the
// host's moderation queue (server/lib/queue.ts, review.ts) and inline (comments, posts); every action is logged, the
// person moderated is told what happened but never by whom, and the reporters are told their report was reviewed.

export type LogAction = 'hide' | 'unhide' | 'remove' | 'lock' | 'unlock' | 'dismiss_report' | 'clear_profile' | 'refer' | 'suspend_user' | 'unsuspend_user' | 'auto_hide'

/** Append to moderation_log. `moderator` null = the system (auto-hide, a suspension that ran out). */
export async function logModeration(entry: { moderator: string | null, action: LogAction, target: { collection: string, item: string }, targetAuthor: string | null, reason: string | null, snapshot: Record<string, unknown> | null }) {
  await create('moderation_log', {
    moderator: entry.moderator,
    action: entry.action,
    target_collection: entry.target.collection,
    target_item: entry.target.item,
    target_author: entry.targetAuthor,
    reason: entry.reason,
    snapshot: entry.snapshot,
    app: useSt8Social().app,
  }, ['id'])
}

// ── Who may act ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Why this moderator can't act on something `owner` owns, or null. Nobody moderates their own things, or someone they
 * have a block with (either way): another moderator reviews those.
 */
export function conflictWith(ctx: SocialContext, owner: string | null | undefined): string | null {
  if (!owner) return null
  if (owner === ctx.me) return 'This is yours, so another moderator needs to review it.'
  if (ctx.blocked.includes(owner)) return 'You have a block with this member, so another moderator needs to review it.'
  return null
}

export function assertNoConflict(ctx: SocialContext, owner: string | null | undefined) {
  const why = conflictWith(ctx, owner)
  if (why) throw createError({ statusCode: 403, message: why })
}

/** A moderator's action: checks the role, then counts toward `limits.moderation`. */
export async function requireModeratorAction(event: SocialEvent, ctx: SocialContext) {
  await requireModerator(ctx)
  await socialRateLimit(event, ctx.me, 'moderation', 'You’ve taken a lot of moderation actions.')
}

/** Active moderators and admins of this app (active accounts). */
export async function appModerators(roles = useSt8Social().moderatorRoles): Promise<string[]> {
  const list = await rows<{ user: { id: string, status: string } | null }>(sys(), 'memberships', {
    fields: [{ user: ['id', 'status'] }],
    filter: { app: { _eq: useSt8Social().app }, role: { _in: roles }, status: { _eq: 'active' } },
    limit: -1,
  })
  return [...new Set(list.filter((m) => m.user?.status === 'active').map((m) => m.user!.id))]
}

/** A `report` notification to the app's moderators about a target (never to its owner, or `exclude`). */
export async function notifyModerators(target: { collection: string, item: string }, data: { kind: 'first' | 'auto_hide' | 'refer', reason?: string | null }, exclude: (string | null | undefined)[], roles?: string[]) {
  const label = socialTarget(target.collection)?.label ?? 'item'
  const skip = new Set(exclude.filter(Boolean))
  const recipients = (await appModerators(roles)).filter((id) => !skip.has(id))
  await notify(null, recipients.map((recipient) => ({ recipient, actor: null, type: 'report' as const, target, data: { label, report: data.kind, reason: data.reason ?? undefined } })))
}

// ── Reports ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Close the pending reports on a target once a moderator has acted on it, and tell each reporter it was reviewed
 * ("took action" or "left it up"; never what, never by whom). Moderators' unread `report` notifications about it are
 * marked read.
 */
export async function resolveReports(target: { collection: string, item: string }, moderator: string | null, outcome: { status: 'actioned' | 'dismissed', action: 'none' | 'hide' | 'remove' | 'lock' | 'clear_profile' | 'refer' | 'suspend_user' }) {
  const app = useSt8Social().app
  const pending = await rows<{ id: string, reporter: string | null }>(sys(), 'reports', {
    fields: ['id', 'reporter'],
    filter: { app: { _eq: app }, target_collection: { _eq: target.collection }, target_item: { _eq: target.item }, status: { _eq: 'pending' } },
    limit: -1,
  })
  if (!pending.length) return
  await sys().request(updateItems('reports', pending.map((r) => r.id), { ...outcome, reviewed_by: moderator, reviewed_at: new Date().toISOString() }))
  const label = socialTarget(target.collection)?.label ?? 'item'
  const reporters = [...new Set(pending.map((r) => r.reporter).filter((id): id is string => !!id && id !== moderator))]
  await notify(null, reporters.map((recipient) => ({
    recipient,
    actor: null,
    type: 'moderation' as const,
    target,
    data: { action: outcome.status === 'actioned' ? 'report_actioned' as const : 'report_dismissed' as const, label },
  })))
  await markNotificationsRead({ type: { _eq: 'report' }, app: { _eq: app }, target_collection: { _eq: target.collection }, target_item: { _eq: target.item } })
}

export interface ReporterFacts {
  joinedAt: string | null
  history: { filed: number, actioned: number, dismissed: number }
}

/** Each reporter's membership age and report record (over `autoHide.historyDays`), for the auto-hide and the queue. */
export async function reporterFacts(reporters: string[]): Promise<Map<string, ReporterFacts>> {
  const ids = [...new Set(reporters.filter(Boolean))]
  const out = new Map<string, ReporterFacts>()
  if (!ids.length) return out
  const { app, autoHide } = useSt8Social()
  const since = new Date(Date.now() - autoHide.historyDays * 86_400_000).toISOString()
  const [memberships, history] = await Promise.all([
    rows<{ user: string, joined_at: string | null, date_created: string | null }>(sys(), 'memberships', {
      fields: ['user', 'joined_at', 'date_created'],
      filter: { user: { _in: ids }, app: { _eq: app } },
      limit: -1,
    }),
    rows<{ reporter: string, status: string }>(sys(), 'reports', {
      fields: ['reporter', 'status'],
      filter: { reporter: { _in: ids }, app: { _eq: app }, date_created: { _gte: since } },
      limit: -1,
    }),
  ])
  for (const id of ids) out.set(id, { joinedAt: null, history: { filed: 0, actioned: 0, dismissed: 0 } })
  for (const m of memberships) {
    const f = out.get(String(m.user))
    if (f) f.joinedAt = m.joined_at ?? m.date_created
  }
  for (const r of history) {
    const f = out.get(String(r.reporter))
    if (!f) continue
    f.history.filed++
    if (r.status === 'actioned') f.history.actioned++
    if (r.status === 'dismissed') f.history.dismissed++
  }
  return out
}

/**
 * Whether a report counts toward the auto-hide, and if not, why. A report whose reporter's account was deleted since
 * (only an admin can delete one) still counts: it was made by an account that qualified or not at the time, and a new
 * account can't get its report counted by leaving.
 */
export function reportWeight(reporter: string | null, facts: Map<string, ReporterFacts>): { counts: boolean, why: string | null } {
  if (!reporter) return { counts: true, why: null }
  const f = facts.get(reporter)
  const { autoHide } = useSt8Social()
  if (!f?.joinedAt || Date.now() - Date.parse(f.joinedAt) < autoHide.memberHours * 3_600_000) return { counts: false, why: 'New member' }
  const reviewed = f.history.actioned + f.history.dismissed
  if (f.history.dismissed >= autoHide.unreliableDismissed && f.history.actioned / reviewed < autoHide.unreliableActionedRatio) return { counts: false, why: 'Often dismissed' }
  return { counts: true, why: null }
}

/** The target's pending reports that count toward the auto-hide. */
async function countingReports(collection: string, item: string): Promise<number> {
  const pending = await rows<{ reporter: string | null }>(sys(), 'reports', {
    fields: ['reporter'],
    filter: { app: { _eq: useSt8Social().app }, target_collection: { _eq: collection }, target_item: { _eq: item }, status: { _eq: 'pending' } },
    limit: -1,
  })
  const facts = await reporterFacts(pending.map((r) => r.reporter).filter((id): id is string => !!id))
  return pending.filter((r) => reportWeight(r.reporter, facts).counts).length
}

/**
 * File a report: one per member per target per app (the unique key), with a snapshot of the target as it is now. Members
 * can't report their own things. The target's first pending report tells the moderators. A comment (or a target with a
 * `moderate` hook) with `autoHideReports` counting reports is hidden until a moderator reviews it, and that is logged.
 */
export async function createReport(event: SocialEvent, ctx: SocialContext, input: { collection?: unknown, item?: unknown, reason?: unknown, details?: unknown }) {
  await socialRateLimit(event, ctx.me, 'reports', 'You’ve sent a lot of reports.')
  await socialRateLimit(event, ctx.me, 'reportsDaily', 'You’ve sent a lot of reports today.')
  const { def, collection, item } = await requireTarget(event, ctx, input, 'reports')
  if (!isReportReason(input.reason)) throw createError({ statusCode: 400, data: { field: 'reason' }, message: 'Choose a reason.' })
  const details = typeof input.details === 'string' ? input.details.replace(/\r\n?/g, '\n').trim() : ''
  if (details.length > REPORT_DETAILS_MAX) throw createError({ statusCode: 400, data: { field: 'details' }, message: `Details can be up to ${REPORT_DETAILS_MAX} characters.` })
  if (input.reason === 'other' && !details) throw createError({ statusCode: 400, data: { field: 'details' }, message: 'Tell us what’s wrong.' })
  const owner = def.owners ? (await def.owners([item])).get(item) : undefined
  if (owner === ctx.me) throw createError({ statusCode: 400, message: `You can’t report your own ${def.label}.` })

  const app = useSt8Social().app
  let created: { id: string }
  try {
    created = await create<{ id: string }>('reports', {
      unique_key: `${app}:${collection}:${item}:${ctx.me}`,
      target_collection: collection,
      target_item: item,
      reporter: ctx.me,
      reason: input.reason,
      details: details || null,
      snapshot: (await def.snapshot?.(item)) ?? null,
      status: 'pending',
      app,
    }, ['id'])
  } catch (err) {
    if (isUniqueViolation(err)) throw createError({ statusCode: 409, message: `You’ve already reported this ${def.label}.` })
    throw err
  }

  // The first pending report on a target (the oldest, so two at once still tell them once) tells the moderators.
  const [oldest] = await rows<{ id: string }>(sys(), 'reports', {
    fields: ['id'],
    filter: { app: { _eq: app }, target_collection: { _eq: collection }, target_item: { _eq: item }, status: { _eq: 'pending' } },
    sort: ['date_created', 'id'],
    limit: 1,
  })
  if (oldest?.id === created.id) await notifyModerators({ collection, item }, { kind: 'first', reason: input.reason }, [ctx.me, owner])

  const autoHidden = collection === 'comments' ? await maybeAutoHide(item) : def.moderate ? await maybeAutoHideTarget(collection, item) : false
  if (autoHidden) await notifyModerators({ collection, item }, { kind: 'auto_hide' }, [owner])
  return { ok: true, autoHidden }
}

/** Any change to a target, announced to everyone viewing it: its thread's version moves (made if needed). */
export async function signalTarget(collection: string, item: string) {
  const thread = await getOrCreateThread(collection, item)
  await touchThread(thread.id)
}

// ── Host items with a `moderate` hook (posts) ──────────────────────────────────────────────────────────────────

/**
 * Hide, unhide or remove a host item through its `moderate` hook: checked, applied by the host, logged with a snapshot,
 * pending reports closed (reporters told), the owner told (never by whom), and the thread version bumped so every open
 * view refetches. `moderator` null = the auto-hide threshold. A moderator's `hide` of an item reports already hid
 * confirms it: it stays hidden, now by a person. `quiet` (a suspension's bulk hide) skips the owner's notification and
 * the per-item log.
 */
export async function applyTargetModeration(collection: string, item: string, action: SocialModerationAction, moderator: string | null, reason: string | null, opts: { pending?: number, quiet?: boolean } = {}) {
  const def = socialTarget(collection)!
  const state = await def.moderate!.state(item)
  if (!state) throw createError({ statusCode: 404, message: 'Not found' })
  const confirm = action === 'hide' && state.status === 'hidden' && !!state.autoHidden && !!moderator
  const allowed = { hide: ['published'], unhide: ['hidden'], remove: ['published', 'hidden'] }[action]
  if (!confirm && !allowed.includes(state.status)) throw createError({ statusCode: 409, message: `This ${def.label} is ${state.status}.` })
  const snapshot = opts.quiet ? null : { ...((await def.snapshot?.(item)) ?? {}), status: state.status, ...(opts.pending ? { reports: opts.pending } : {}) }
  await def.moderate!.apply(item, action, { moderator, reason })
  if (opts.quiet) return
  await logModeration({ moderator, action: moderator ? action : 'auto_hide', target: { collection, item }, targetAuthor: state.owner, reason, snapshot })
  // An automatic hide keeps its reports pending: they are the moderators' queue.
  if (moderator) await resolveReports({ collection, item }, moderator, action === 'unhide' ? { status: 'dismissed', action: 'none' } : { status: 'actioned', action })
  if (state.owner) {
    await notify(null, [{
      recipient: state.owner,
      actor: null,
      type: 'moderation',
      target: { collection, item },
      data: { action: moderator ? action : 'auto_hide', label: def.label, on: { collection, item } },
    }])
  }
  await signalTarget(collection, item)
}

async function maybeAutoHideTarget(collection: string, item: string): Promise<boolean> {
  const threshold = useSt8Social().autoHideReports
  return withLock(`target:${collection}:${item}`, async () => {
    const counting = await countingReports(collection, item)
    if (counting < threshold) return false
    const state = await socialTarget(collection)!.moderate!.state(item)
    if (state?.status !== 'published') return false
    await applyTargetModeration(collection, item, 'hide', null, `Hidden automatically after ${counting} reports`, { pending: counting })
    return true
  })
}

/** Moderators: `{ collection, item, action: hide | unhide | remove, reason? }` on a host item with a `moderate` hook. */
export async function moderateTarget(event: SocialEvent, ctx: SocialContext) {
  await requireModeratorAction(event, ctx)
  const input = await readJson<{ collection: string, item: string, action: string, reason: string }>(event)
  const def = socialTarget(input.collection)
  if (!def?.moderate) throw createError({ statusCode: 400, message: 'Unknown target.' })
  const action = input.action as SocialModerationAction
  if (!['hide', 'unhide', 'remove'].includes(action)) throw createError({ statusCode: 400, message: 'Unknown action.' })
  const item = typeof input.item === 'number' ? String(input.item) : input.item
  if (typeof item !== 'string' || !item || item.length > 64) throw createError({ statusCode: 400, message: 'Unknown target.' })
  // A moderator must be able to see it (hidden items included, by their policy).
  const visible = await def.visible([item], { event, viewer: ctx.me })
  if (!visible.has(item)) throw createError({ statusCode: 404, message: 'Not found' })
  assertNoConflict(ctx, (await def.moderate.state(item))?.owner)
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) || null : null
  await withLock(`target:${def.collection}:${item}`, () => applyTargetModeration(def.collection, item, action, ctx.me, reason))
  return { ok: true, status: (await def.moderate.state(item))?.status ?? null, thread: await summarizeOne(event, ctx, def.collection, item).catch(() => null) }
}

// ── Comments ───────────────────────────────────────────────────────────────────────────────────────────────────

async function maybeAutoHide(commentId: string): Promise<boolean> {
  const threshold = useSt8Social().autoHideReports
  return withLock(`comment:${commentId}`, async () => {
    const counting = await countingReports('comments', commentId)
    if (counting < threshold) return false
    const c = await byId<{ id: string, thread: string, author: string | null, body: string | null, status: string }>(sys(), 'comments', commentId, ['id', 'thread', 'author', 'body', 'status'])
    if (!c || c.status !== 'published') return false
    const reason = `Hidden automatically after ${counting} reports`
    await update('comments', c.id, { status: 'hidden', hidden_by: null, hidden_at: new Date().toISOString(), hidden_reason: reason })
    await logModeration({ moderator: null, action: 'auto_hide', target: { collection: 'comments', item: c.id }, targetAuthor: c.author, reason, snapshot: { body: c.body, author: c.author, reports: counting } })
    const t = await byId<{ target_collection: string, target_item: string }>(sys(), 'threads', c.thread, ['target_collection', 'target_item'])
    if (c.author) {
      await notify(null, [{
        recipient: c.author,
        actor: null,
        type: 'moderation',
        target: { collection: 'comments', item: c.id },
        data: { action: 'auto_hide', label: 'comment', on: t ? { collection: t.target_collection, item: t.target_item } : undefined, comment: c.id, snippet: await snippetFrom(c.body) },
      }])
    }
    await touchThread(c.thread)
    return true
  })
}
