import type { QueueAction, QueueItem } from '../../shared/types/social'
import { type SocialContext, type SocialEvent, count, readJson, sys, withLock } from './core'
import { applyCommentModeration, readAppComment, setThreadLock } from './comments'
import { applyTargetModeration, assertNoConflict, logModeration, notifyModerators, requireModeratorAction, resolveReports } from './moderation'
import { notify } from './notifications'
import { inspectTarget, readQueue } from './queue'

// The moderation queue's actions (Phase 8): `POST /api/social/moderation/resolve` `{ collection, item, action, reason? }`
// on one reported target. Each goes through the same code as the inline actions (comments, posts), so it's logged,
// closes the pending reports (the reporters are told it was reviewed), and tells the person moderated what happened,
// never by whom. Suspending has its own route (suspensions.ts).

const ACTIONS: QueueAction[] = ['dismiss', 'hide', 'unhide', 'remove', 'lock', 'unlock', 'clear', 'refer']

export async function resolveQueueItem(event: SocialEvent, ctx: SocialContext): Promise<QueueItem | null> {
  await requireModeratorAction(event, ctx)
  const input = await readJson<{ collection: string, item: string | number, action: string, reason: string }>(event)
  const def = socialTarget(input.collection)
  const item = typeof input.item === 'number' ? String(input.item) : input.item
  if (!def || typeof item !== 'string' || !item || item.length > 64) throw createError({ statusCode: 400, message: 'Unknown target.' })
  const action = input.action as QueueAction
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 400, message: 'Unknown action.' })
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) || null : null
  const collection = def.collection
  const target = { collection, item }

  await withLock(`${collection === 'comments' ? 'comment' : 'target'}:${collection === 'comments' ? item : `${collection}:${item}`}`, async () => {
    const s = await inspectTarget(collection, item)
    assertNoConflict(ctx, s.owner)
    const moderatable = collection === 'comments' || !!def.moderate
    const moderate = async (a: 'hide' | 'unhide' | 'remove') => {
      if (s.state === 'gone') throw createError({ statusCode: 404, message: 'It’s gone.' })
      if (collection === 'comments') {
        const c = await readAppComment(item)
        if (!c) throw createError({ statusCode: 404, message: 'Comment not found' })
        await applyCommentModeration(ctx.me, c, a, reason)
      } else {
        await applyTargetModeration(collection, item, a, ctx.me, reason)
      }
    }

    switch (action) {
      case 'hide':
      case 'unhide':
      case 'remove':
        if (!moderatable) throw createError({ statusCode: 400, message: `A ${def.label} can’t be ${action === 'remove' ? 'removed' : 'hidden'} here.` })
        return moderate(action)

      case 'dismiss': {
        // "Leave it up": a hidden item comes back (that dismisses its reports); otherwise the reports close as dismissed.
        if (moderatable && s.state === 'hidden') return moderate('unhide')
        const pending = await count(sys(), 'reports', { app: { _eq: useSt8Social().app }, target_collection: { _eq: collection }, target_item: { _eq: item }, status: { _eq: 'pending' } })
        if (!pending) throw createError({ statusCode: 409, message: 'There’s nothing pending to dismiss.' })
        await logModeration({ moderator: ctx.me, action: 'dismiss_report', target, targetAuthor: s.owner, reason, snapshot: { reports: pending, state: s.state } })
        return resolveReports(target, ctx.me, { status: 'dismissed', action: 'none' })
      }

      case 'lock':
      case 'unlock': {
        // A comment's reports close by locking the conversation it's in.
        const on = collection === 'comments' ? s.on : (def.comments ? target : null)
        if (!on) throw createError({ statusCode: 400, message: `A ${def.label} has no comments to close.` })
        const onDef = socialTarget(on.collection)
        const onOwner = collection === 'comments' && onDef?.owners ? ((await onDef.owners([on.item])).get(on.item) ?? null) : s.owner
        assertNoConflict(ctx, onOwner)
        await setThreadLock(ctx.me, on.collection, on.item, action === 'lock', onOwner)
        if (action === 'lock') await resolveReports(target, ctx.me, { status: 'actioned', action: 'lock' })
        return
      }

      case 'clear': {
        if (!def.clear) throw createError({ statusCode: 400, message: `A ${def.label} can’t be cleared.` })
        const snapshot = (await def.snapshot?.(item)) ?? null
        await def.clear(item)
        await logModeration({ moderator: ctx.me, action: 'clear_profile', target, targetAuthor: s.owner, reason, snapshot })
        await resolveReports(target, ctx.me, { status: 'actioned', action: 'clear_profile' })
        if (s.owner) await notify(null, [{ recipient: s.owner, actor: null, type: 'moderation', target, data: { action: 'clear', label: def.label } }])
        return
      }

      case 'refer': {
        // Things this app can't change (a shared event): closed here, and the admins are told to fix it at the source.
        const pending = await count(sys(), 'reports', { app: { _eq: useSt8Social().app }, target_collection: { _eq: collection }, target_item: { _eq: item }, status: { _eq: 'pending' } })
        if (!pending) throw createError({ statusCode: 409, message: 'There’s nothing pending to refer.' })
        await logModeration({ moderator: ctx.me, action: 'refer', target, targetAuthor: s.owner, reason, snapshot: (await def.snapshot?.(item)) ?? null })
        await resolveReports(target, ctx.me, { status: 'actioned', action: 'refer' })
        await notifyModerators(target, { kind: 'refer' }, [ctx.me], ['admin'])
        return
      }
    }
  })

  return (await readQueue(ctx, { tab: 'pending', target: `${collection}:${item}` })).items[0] ?? null
}
