import { type SocialContext, type SocialEvent, isSocialId, readJson, rows, socialRateLimit, sys } from './core'
import { COMMENT_FIELDS, type CommentRow, applyCommentModeration } from './comments'
import { touchThread } from './counters'
import { applyTargetModeration, assertNoConflict, logModeration, requireModeratorAction, resolveReports, signalTarget } from './moderation'
import { notify } from './notifications'
import { hiddenWith, inspectTarget, moderatorRole, outranks, suspensionEntries } from './queue'

// Suspending a member of this app (Phase 8). The membership (layers/st8-auth: suspendMembership / restoreMembership)
// is the switch: sign-in refuses it, live sessions end within 30 s of their next request, this app's policies go at
// once, and nothing else (role, account, other apps, the Studio) changes. Here: who may do it, the optional hide of
// everything they posted in this app, the log, the reports it closes, and what the member is told.

/** layers/st8-auth's membership change event. */
type MembershipChange = Parameters<Parameters<typeof onMembershipChange>[0]>[0]

const HIDE_REASON = 'Hidden with a suspension'
const MAX_YEARS = 5

/** Hide everything `user` has published in this app (comments, and host items with `ownedBy`), quietly. */
async function hideContentOf(user: string, moderator: string): Promise<Record<string, string[]>> {
  const hidden: Record<string, string[]> = {}
  const comments = await rows<CommentRow>(sys(), 'comments', {
    fields: COMMENT_FIELDS,
    filter: { author: { _eq: user }, status: { _eq: 'published' }, thread: { app: { _eq: useSt8Social().app } } },
    limit: -1,
  })
  const threads = new Set<string>()
  for (const c of comments) {
    await applyCommentModeration(moderator, c, 'hide', HIDE_REASON, { quiet: true })
    threads.add(c.thread)
  }
  if (comments.length) hidden.comments = comments.map((c) => c.id)
  for (const def of socialTargets()) {
    if (!def.ownedBy || !def.moderate) continue
    const ids = await def.ownedBy(user)
    for (const id of ids) await applyTargetModeration(def.collection, id, 'hide', moderator, HIDE_REASON, { quiet: true })
    for (const id of ids) await signalTarget(def.collection, id)
    if (ids.length) hidden[def.collection] = ids
  }
  for (const id of threads) await touchThread(id)
  return hidden
}

/** Unhide what a suspension hid and is still hidden (a comment hidden for another reason since stays). Returns how many. */
async function restoreContent(hidden: Record<string, string[]>, moderator: string | null): Promise<number> {
  let restored = 0
  const commentIds = (hidden.comments ?? []).filter(isSocialId)
  if (commentIds.length) {
    const list = await rows<CommentRow>(sys(), 'comments', { fields: COMMENT_FIELDS, filter: { id: { _in: commentIds }, status: { _eq: 'hidden' }, hidden_reason: { _eq: HIDE_REASON } }, limit: -1 })
    const threads = new Set<string>()
    for (const c of list) {
      await applyCommentModeration(moderator, c, 'unhide', null, { quiet: true })
      threads.add(c.thread)
      restored++
    }
    for (const id of threads) await touchThread(id)
  }
  for (const [collection, ids] of Object.entries(hidden)) {
    const def = socialTarget(collection)
    if (collection === 'comments' || !def?.moderate) continue
    for (const id of ids) {
      if ((await def.moderate.state(id))?.status !== 'hidden') continue
      await applyTargetModeration(collection, id, 'unhide', moderator, null, { quiet: true })
      await signalTarget(collection, id)
      restored++
    }
  }
  return restored
}

function parseUntil(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (Number.isNaN(at)) throw createError({ statusCode: 400, data: { field: 'until' }, message: 'Choose when the suspension ends.' })
  if (at < Date.now() + 60_000) throw createError({ statusCode: 400, data: { field: 'until' }, message: 'The end must be in the future.' })
  if (at > Date.now() + MAX_YEARS * 365 * 86_400_000) throw createError({ statusCode: 400, data: { field: 'until' }, message: `At most ${MAX_YEARS} years; leave it open-ended instead.` })
  return new Date(at).toISOString()
}

/** A member of this app the viewer may suspend or restore: not themselves, not across a block, and outranked. */
async function requireSuspendable(ctx: SocialContext, user: unknown) {
  if (!isSocialId(user)) throw createError({ statusCode: 400, data: { field: 'user' }, message: 'Unknown member.' })
  if (user === ctx.me) throw createError({ statusCode: 403, message: 'You can’t suspend yourself.' })
  assertNoConflict(ctx, user)
  const membership = await readMembership(user, useSt8Social().app)
  if (!membership) throw createError({ statusCode: 404, message: 'Not a member here.' })
  if (!outranks(await moderatorRole(ctx), membership.role)) {
    throw createError({ statusCode: 403, message: membership.role === 'admin' ? 'Admins can’t be suspended here.' : 'Only an admin can suspend a moderator.' })
  }
  return { user, membership }
}

/**
 * `POST /api/social/moderation/suspend` `{ user, until: ISO | null, reason, hideContent?, from?: { collection, item } }`:
 * suspend a member here. `from` is the reported item the suspension answers; its pending reports (and any on their
 * profile) are closed as actioned.
 */
export async function suspendMember(event: SocialEvent, ctx: SocialContext) {
  await requireModeratorAction(event, ctx)
  const input = await readJson<{ user: string, until: string | null, reason: string, hideContent: boolean, from: { collection?: string, item?: string } }>(event)
  const { user, membership } = await requireSuspendable(ctx, input.user)
  if (membership.status === 'suspended') throw createError({ statusCode: 409, message: 'They’re already suspended.' })
  const until = parseUntil(input.until)
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : ''
  if (!reason) throw createError({ statusCode: 400, data: { field: 'reason' }, message: 'Give a reason (only moderators see it).' })
  if (input.hideContent !== undefined && typeof input.hideContent !== 'boolean') throw createError({ statusCode: 400, data: { field: 'hideContent' }, message: '`hideContent` must be true or false.' })
  // The reported item must be theirs, or its reports would be closed by someone else's suspension.
  let from: { collection: string, item: string } | null = null
  if (input.from && typeof input.from === 'object' && socialTarget(input.from.collection) && typeof input.from.item === 'string') {
    if ((await inspectTarget(input.from.collection!, input.from.item)).owner !== user) throw createError({ statusCode: 400, data: { field: 'from' }, message: 'That isn’t theirs.' })
    from = { collection: input.from.collection!, item: input.from.item }
  }
  await socialRateLimit(event, ctx.me, 'suspensions', 'You’ve suspended a lot of members today.')

  const app = useSt8Social().app
  if (!(await suspendMembership(user, app, { until, reason, by: ctx.me }))) throw createError({ statusCode: 409, message: 'They’re already suspended.' })
  const hidden = input.hideContent ? await hideContentOf(user, ctx.me) : {}
  await logModeration({
    moderator: ctx.me,
    action: 'suspend_user',
    target: { collection: 'directus_users', item: user },
    targetAuthor: user,
    reason,
    snapshot: { until, role: membership.role, hidden, from: from ? `${from.collection}:${from.item}` : null },
  })
  await resolveReports({ collection: 'directus_users', item: user }, ctx.me, { status: 'actioned', action: 'suspend_user' })
  if (from) await resolveReports(from, ctx.me, { status: 'actioned', action: 'suspend_user' })
  return { ok: true, until, hidden: Object.values(hidden).reduce((n, ids) => n + ids.length, 0) }
}

/** `POST /api/social/moderation/unsuspend` `{ user, restoreContent? }`: restore a member here. */
export async function unsuspendMember(event: SocialEvent, ctx: SocialContext) {
  await requireModeratorAction(event, ctx)
  const input = await readJson<{ user: string, restoreContent: boolean }>(event)
  const { user, membership } = await requireSuspendable(ctx, input.user)
  if (membership.status !== 'suspended') throw createError({ statusCode: 409, message: 'They aren’t suspended.' })
  if (!(await restoreMembership(user, useSt8Social().app, { by: ctx.me }))) throw createError({ statusCode: 409, message: 'They aren’t suspended.' })
  const restored = input.restoreContent === true ? await restoreContent(hiddenWith((await suspensionEntries([user])).get(user)?.snapshot), ctx.me) : 0
  await afterRestore(user, ctx.me, null, restored)
  return { ok: true, restored }
}

async function afterRestore(user: string, moderator: string | null, reason: string | null, restored: number) {
  await logModeration({ moderator, action: 'unsuspend_user', target: { collection: 'directus_users', item: user }, targetAuthor: user, reason, snapshot: { restored } })
  await notify(null, [{ recipient: user, actor: null, type: 'moderation', target: { collection: 'directus_users', item: user }, data: { action: 'unsuspend', label: 'membership' } }])
}

/**
 * layers/st8-auth's membership changes this app didn't make itself: a suspension that ran out (restored with what it
 * hid, logged as the system) and an admin's edit in the Studio (logged under their name; content untouched).
 */
export async function onMembershipChanged(change: MembershipChange) {
  if (change.app !== useSt8Social().app || change.source === 'app') return
  if (change.status === 'active') {
    const restored = change.source === 'expiry' ? await restoreContent(hiddenWith((await suspensionEntries([change.user])).get(change.user)?.snapshot), null) : 0
    await afterRestore(change.user, change.by, change.reason ?? (change.source === 'studio' ? 'Restored in Directus' : null), restored)
    return
  }
  await logModeration({
    moderator: change.by,
    action: 'suspend_user',
    target: { collection: 'directus_users', item: change.user },
    targetAuthor: change.user,
    reason: change.reason,
    snapshot: { until: change.until, source: change.source, hidden: {} },
  })
}
