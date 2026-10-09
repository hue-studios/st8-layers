import { randomBytes } from 'node:crypto'
import type { InvitePreview, InviteRedeemResult, MyInvite } from '../../shared/types/network'
import { createRow, isUserId, pairKey, readEdge, rows, stateFor, updateRow, deleteRow } from './edges'
import { networkPeople } from './people'

// Personal invite links (`invites`): one live link per member per app, reusable by many people, each of whom can
// redeem it once (`invite_redemptions`, so someone the inviter later removed can't reconnect with it). Redeeming makes
// an accepted connection at once: sharing the link is the inviter's consent, following it is the redeemer's. A link
// works for `inviteDays`; resetting it ends it immediately.

interface InviteRow { id: string, code: string, inviter: string, expires_at: string | null, app: string | null }

const CODE = /^[A-Za-z0-9_-]{6,32}$/
export const isInviteCode = (value: unknown): value is string => typeof value === 'string' && CODE.test(value)

const urlOf = (code: string) => {
  const cfg = useSt8Network()
  return `${cfg.appUrl}${cfg.invitePath}${code}`
}
const toMine = (row: InviteRow): MyInvite => ({ code: row.code, url: urlOf(row.code), expiresAt: row.expires_at! })

async function liveInvites(me: string): Promise<InviteRow[]> {
  return rows<InviteRow>('invites', {
    fields: ['id', 'code', 'inviter', 'expires_at', 'app'],
    filter: { inviter: { _eq: me }, app: { _eq: useSt8Network().app }, target_email: { _null: true }, expires_at: { _gt: new Date().toISOString() } },
    sort: ['-date_created'],
    limit: 10,
  })
}

async function mint(me: string): Promise<InviteRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = {
      code: randomBytes(6).toString('base64url'),
      inviter: me,
      app: useSt8Network().app,
      expires_at: new Date(Date.now() + useSt8Network().inviteMs).toISOString(),
    }
    try {
      const created = await createRow<{ id: string }>('invites', row)
      return { id: created.id, ...row }
    } catch (err) {
      if (!st8SocialServer.isUniqueViolation(err)) throw err
    }
  }
  throw createError({ statusCode: 500, message: 'Couldn’t make a link. Try again.' })
}

/** My live link, made on first use. */
export function myInvite(me: string): Promise<MyInvite> {
  return st8SocialServer.withLock(`network:invite:${me}`, async () => {
    const [live] = await liveInvites(me)
    return toMine(live ?? (await mint(me)))
  })
}

/** End my live link(s) now and make a new one. */
export function resetInvite(me: string): Promise<MyInvite> {
  return st8SocialServer.withLock(`network:invite:${me}`, async () => {
    const now = new Date().toISOString()
    for (const row of await liveInvites(me)) await updateRow('invites', row.id, { expires_at: now })
    return toMine(await mint(me))
  })
}

async function readInvite(code: string): Promise<InviteRow | null> {
  const [row] = await rows<InviteRow>('invites', {
    fields: ['id', 'code', 'inviter', 'expires_at', 'app'],
    filter: { code: { _eq: code }, app: { _eq: useSt8Network().app } },
    limit: 1,
  })
  return row ?? null
}

const expired = (row: InviteRow) => !!row.expires_at && Date.parse(row.expires_at) <= Date.now()

/**
 * What the public landing shows: the inviter's name, photo and work, nothing else. Unknown, an inviter who isn't an
 * active member, or (signed in) across a block: `unknown`.
 */
export async function previewInvite(code: unknown, viewer: string | null): Promise<InvitePreview> {
  const none: InvitePreview = { status: 'unknown', inviter: null }
  if (!isInviteCode(code)) return none
  const row = await readInvite(code)
  if (!row || !isUserId(row.inviter)) return none
  if (!(await st8SocialServer.activeMembers([row.inviter])).has(row.inviter)) return none
  if (viewer && viewer !== row.inviter && (await st8SocialServer.blockedWith(viewer)).includes(row.inviter)) return none
  if (expired(row)) return { status: 'expired', inviter: null }
  const person = (await networkPeople([row.inviter])).get(row.inviter)
  if (!person) return none
  const { id, name, first_name, avatar, title, company, headline, industry } = person
  const preview: InvitePreview = { status: 'valid', inviter: { id, name, first_name, avatar, title, company, headline, industry } }
  if (viewer) {
    preview.self = viewer === row.inviter
    const state = stateFor(viewer, await readEdge(viewer, row.inviter))
    preview.state = state === 'hidden' ? 'none' : state
  }
  return preview
}

/** Redeem a link: connect with the inviter now. Once per person per link. */
export async function redeemInvite(event: Parameters<typeof getRequestIP>[0], ctx: St8SocialContext, code: unknown): Promise<InviteRedeemResult> {
  if (!isInviteCode(code)) throw createError({ statusCode: 404, message: 'That invite link isn’t valid.' })
  await networkRateLimit(event, ctx.me, 'redeems', 'That’s a lot of invite links.')
  const row = await readInvite(code)
  const invalid = () => createError({ statusCode: 404, message: 'That invite link isn’t valid.' })
  if (!row || !isUserId(row.inviter)) throw invalid()
  const inviter = row.inviter
  if (inviter === ctx.me) throw createError({ statusCode: 400, message: 'That’s your own invite link. Share it with someone else.' })
  if (ctx.blocked.includes(inviter) || !(await st8SocialServer.activeMembers([inviter])).has(inviter)) throw invalid()
  if (expired(row)) throw createError({ statusCode: 410, message: 'That invite link has expired. Ask for a new one.' })

  const result = await st8SocialServer.withLock(`network:${pairKey(ctx.me, inviter)}`, async () => {
    const edge = await readEdge(ctx.me, inviter)
    const state = stateFor(ctx.me, edge)
    if (state === 'hidden') throw invalid()
    if (state === 'blocked') throw createError({ statusCode: 409, message: 'You’ve blocked them. Unblock them first.' })
    const [used] = await rows<{ id: string }>('invite_redemptions', { fields: ['id'], filter: { unique_key: { _eq: `${row.id}:${ctx.me}` } }, limit: 1 })
    if (state === 'connected') {
      if (!used) await recordRedemption(row, ctx.me)
      return { already: true }
    }
    if (used) throw createError({ statusCode: 409, message: 'You’ve already used this invite link.' })
    // Claim the redemption first: of two parallel redeems, only one gets past the unique key.
    if (!(await recordRedemption(row, ctx.me))) throw createError({ statusCode: 409, message: 'You’ve already used this invite link.' })
    if (edge) {
      await updateRow('connections', edge.id, { status: 'accepted' })
    } else {
      try {
        await createRow('connections', { unique_key: pairKey(inviter, ctx.me), requester: inviter, addressee: ctx.me, status: 'accepted', app: useSt8Network().app })
      } catch (err) {
        if (!st8SocialServer.isUniqueViolation(err)) throw err
        // Another instance made the pair's edge meanwhile: accept whatever it is, unless it's a block.
        const raced = await readEdge(ctx.me, inviter)
        if (!raced || raced.status === 'blocked') {
          await undoRedemption(row, ctx.me)
          throw invalid()
        }
        if (raced.status !== 'accepted') await updateRow('connections', raced.id, { status: 'accepted' })
      }
    }
    return { already: false }
  })

  if (!result.already) {
    await updateRow('invites', row.id, { accepted_by: ctx.me, accepted_at: new Date().toISOString() })
    await st8SocialServer.markNotificationsRead({ recipient: { _eq: ctx.me }, actor: { _eq: inviter }, type: { _eq: 'connection_request' } })
    await st8SocialServer.withdrawNotifications({ recipient: { _eq: inviter }, actor: { _eq: ctx.me }, type: { _eq: 'connection_request' } })
    await st8SocialServer.notify(ctx, [{ recipient: inviter, actor: ctx.me, type: 'connection_accepted', target: { collection: 'directus_users', item: ctx.me }, data: { via: 'invite' } }])
  }
  const person = (await networkPeople([inviter])).get(inviter)
  if (!person) throw invalid()
  return { state: 'connected', already: result.already, inviter: person }
}

async function recordRedemption(row: InviteRow, me: string): Promise<boolean> {
  try {
    await createRow('invite_redemptions', { unique_key: `${row.id}:${me}`, invite: row.id, user: me })
    return true
  } catch (err) {
    if (st8SocialServer.isUniqueViolation(err)) return false
    throw err
  }
}

async function undoRedemption(row: InviteRow, me: string) {
  const [r] = await rows<{ id: string }>('invite_redemptions', { fields: ['id'], filter: { unique_key: { _eq: `${row.id}:${me}` } }, limit: 1 })
  if (r) await deleteRow('invite_redemptions', r.id)
}
