import { activeMembers, resolvePeople } from '../lib/people'
import { blockedWith, isUniqueViolation, limitRate, socialContext, withLock } from '../lib/core'
import { markNotificationsRead, notify, withdrawNotifications } from '../lib/notifications'

// The pieces of the st8-social server that other ST8 layers build on (st8-network: connections, blocks, intros,
// invites). Host apps don't need them. Everything else stays in server/lib, out of the host's auto-import namespace.

export const st8SocialServer = {
  /** The signed-in member with an active membership in this app (403 otherwise): `me`, their client, blocks. */
  socialContext,
  /** Everyone on the other side of a block with this member, either direction. */
  blockedWith,
  /** People by id (name, avatar, title, accent colour), never an email. */
  resolvePeople,
  /** The ids that are active accounts with an active membership in this app. */
  activeMembers,
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
