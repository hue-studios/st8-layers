import { updateItems } from '@directus/sdk'
import { REPORT_DETAILS_MAX, isReportReason } from '../../shared/utils/social'
import { type SocialContext, type SocialEvent, byId, count, create, isUniqueViolation, rows, socialRateLimit, sys, update, withLock } from './core'
import { touchThread } from './counters'
import { notify, snippetFrom } from './notifications'
import { requireTarget } from './threads'

// Reports, the moderation log and auto-hide (docs/go-live-plan.md §5, "Moderation"). The Studio is the moderation
// console (reports queue, moderation_log); the app's moderators act through moderateComment / lockThread.

type LogAction = 'hide' | 'unhide' | 'remove' | 'lock' | 'unlock' | 'dismiss_report' | 'suspend_user' | 'auto_hide'

/** Append to moderation_log. `moderator` null = the system (auto-hide). */
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

/** Close the pending reports on a target once a moderator has acted on it. */
export async function resolveReports(target: { collection: string, item: string }, moderator: string | null, outcome: { status: 'actioned' | 'dismissed', action: 'none' | 'hide' | 'remove' }) {
  const pending = await rows<{ id: string }>(sys(), 'reports', {
    fields: ['id'],
    filter: { app: { _eq: useSt8Social().app }, target_collection: { _eq: target.collection }, target_item: { _eq: target.item }, status: { _eq: 'pending' } },
    limit: -1,
  })
  if (!pending.length) return
  await sys().request(updateItems('reports', pending.map((r) => r.id), { ...outcome, reviewed_by: moderator, reviewed_at: new Date().toISOString() }))
}

/**
 * File a report: one per member per target per app (the unique key), with a snapshot of the target as it is now. Members
 * can't report their own things. A comment with `autoHideReports` distinct pending reports is hidden until a moderator
 * reviews it, and that is logged.
 */
export async function createReport(event: SocialEvent, ctx: SocialContext, input: { collection?: unknown, item?: unknown, reason?: unknown, details?: unknown }) {
  await socialRateLimit(event, ctx.me, 'reports', 'You’ve sent a lot of reports.')
  const { def, collection, item } = await requireTarget(event, ctx, input, 'reports')
  if (!isReportReason(input.reason)) throw createError({ statusCode: 400, data: { field: 'reason' }, message: 'Choose a reason.' })
  const details = typeof input.details === 'string' ? input.details.replace(/\r\n?/g, '\n').trim() : ''
  if (details.length > REPORT_DETAILS_MAX) throw createError({ statusCode: 400, data: { field: 'details' }, message: `Details can be up to ${REPORT_DETAILS_MAX} characters.` })
  if (input.reason === 'other' && !details) throw createError({ statusCode: 400, data: { field: 'details' }, message: 'Tell us what’s wrong.' })
  const owner = def.owners ? (await def.owners([item])).get(item) : undefined
  if (owner === ctx.me) throw createError({ statusCode: 400, message: `You can’t report your own ${def.label}.` })

  try {
    await create('reports', {
      unique_key: `${useSt8Social().app}:${collection}:${item}:${ctx.me}`,
      target_collection: collection,
      target_item: item,
      reporter: ctx.me,
      reason: input.reason,
      details: details || null,
      snapshot: (await def.snapshot?.(item)) ?? null,
      status: 'pending',
      app: useSt8Social().app,
    }, ['id'])
  } catch (err) {
    if (isUniqueViolation(err)) throw createError({ statusCode: 409, message: `You’ve already reported this ${def.label}.` })
    throw err
  }

  const autoHidden = collection === 'comments' ? await maybeAutoHide(item) : false
  return { ok: true, autoHidden }
}

async function maybeAutoHide(commentId: string): Promise<boolean> {
  const threshold = useSt8Social().autoHideReports
  return withLock(`comment:${commentId}`, async () => {
    const pending = await count(sys(), 'reports', { app: { _eq: useSt8Social().app }, target_collection: { _eq: 'comments' }, target_item: { _eq: commentId }, status: { _eq: 'pending' } })
    if (pending < threshold) return false
    const c = await byId<{ id: string, thread: string, author: string | null, body: string | null, status: string }>(sys(), 'comments', commentId, ['id', 'thread', 'author', 'body', 'status'])
    if (!c || c.status !== 'published') return false
    const reason = `Hidden automatically after ${pending} reports`
    await update('comments', c.id, { status: 'hidden', hidden_by: null, hidden_at: new Date().toISOString(), hidden_reason: reason })
    await logModeration({ moderator: null, action: 'auto_hide', target: { collection: 'comments', item: c.id }, targetAuthor: c.author, reason, snapshot: { body: c.body, author: c.author, reports: pending } })
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
