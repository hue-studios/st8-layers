import { activeMembers, mentionable, resolvePeople } from '../lib/people'
import { blockedWith, forgetBlocks, isUniqueViolation, limitRate, socialContext, withLock } from '../lib/core'
import { markNotificationsRead, notify, snippetOf, withdrawNotifications } from '../lib/notifications'
import { signalTarget } from '../lib/moderation'
import { deleteTargetSocial } from '../lib/targets'

// The pieces of the st8-social server that other ST8 layers (st8-network: connections, blocks, intros, invites) and a
// host's own social content (Insider: posts) build on. Everything else stays in server/lib, out of the host's
// auto-import namespace.

export const st8SocialServer = {
  /** The signed-in member with an active membership in this app (403 otherwise): `me`, their client, blocks. */
  socialContext,
  /** Everyone on the other side of a block with this member, either direction (memoised a few seconds per instance). */
  blockedWith,
  /** After a block or unblock between them: drop these members' memoised blocks on this instance. */
  forgetBlocks,
  /** People by id (name, avatar, title, accent colour), never an email. */
  resolvePeople,
  /** The ids that are active accounts with an active membership in this app. */
  activeMembers,
  /** Of `ids`, the people this member may mention: active members here, not themselves, not blocked either way. */
  mentionable,
  /** A short plain excerpt of a body (mentions as names, markdown markers dropped) for notifications. */
  snippetOf,
  /** Announce a change to a target: its thread's version moves (made if needed), so open views refetch. */
  signalTarget,
  /** A target is gone for good: delete its conversation here (comments, reactions, notifications, thread). */
  deleteTargetSocial,
  /** Create notifications (never to yourself, never across a block). */
  notify,
  /** Delete the unread notifications matching a filter. */
  withdrawNotifications,
  /** Mark the unread notifications matching a filter read. */
  markNotificationsRead,
  /** Fixed-window rate limit on the 'st8-social-rate-limit' mount: `limitRate(event, key, [max, seconds], message)`. */
  limitRate,
  /** Serialise work per key in this server instance. */
  withLock,
  /** True when Directus refused a create on a unique column. */
  isUniqueViolation,
}

export type St8SocialContext = Awaited<ReturnType<typeof socialContext>>
