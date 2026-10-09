import type { ConnectionState } from '../../shared/types/network'
import { acceptedNeighbours, edgesBetween, mutualsOf, secondDegree, stateFor } from '../lib/edges'

// The st8-network layer's public server API: its config, and the reads a host needs to build people lists (member
// search, "people you may know") that show connection state. Everything else lives in server/lib.

type NetworkEventArg = Parameters<typeof getRequestIP>[0]
type Limit = [number, number]
export type NetworkLimit = 'requests' | 'responses' | 'blocks' | 'intros' | 'redeems' | 'inviteResets' | 'search' | 'invitePreview'

/** The layer's runtime config with its defaults (nuxt.config.ts documents each key). */
export function useSt8Network() {
  const config = useRuntimeConfig()
  const network = (config.st8Network ?? {}) as unknown as Partial<{
    limits: Partial<Record<NetworkLimit, Limit>>
    maxOutgoing: number
    withdrawCooldownDays: number
    inviteDays: number
    introRepeatDays: number
    ranking: Partial<Record<string, number>>
  }>
  const pub = (config.public.st8Network ?? {}) as Partial<{ connectionsPath: string, invitePath: string, inviteCookie: string }>
  const social = (config.public.st8Social ?? {}) as Partial<{ profilePath: string }>
  return {
    /** The ST8 app this server is (st8-auth's `st8Auth.app`). */
    app: useSt8Auth().app,
    limits: {
      requests: [20, 86400],
      responses: [120, 3600],
      blocks: [30, 86400],
      intros: [10, 86400],
      redeems: [10, 3600],
      inviteResets: [5, 86400],
      search: [60, 60],
      invitePreview: [60, 60],
      ...network.limits,
    } as Record<NetworkLimit, Limit>,
    maxOutgoing: network.maxOutgoing ?? 100,
    withdrawCooldownMs: (network.withdrawCooldownDays ?? 21) * 86_400_000,
    inviteMs: (network.inviteDays ?? 30) * 86_400_000,
    introRepeatMs: (network.introRepeatDays ?? 30) * 86_400_000,
    ranking: {
      interaction: 0.5,
      recency: 0.3,
      mutuals: 0.2,
      interactionHalfLifeDays: 30,
      interactionWindowDays: 180,
      recencyHalfLifeDays: 60,
      dailyCap: 3,
      ...network.ranking,
    },
    connectionsPath: pub.connectionsPath || '/connections',
    invitePath: pub.invitePath || '/i/',
    /** A member's profile path, or null when the host has none (public.st8Social.profilePath). */
    profilePath: (id: string) => (social.profilePath ? social.profilePath.replace(':id', id) : null),
    appUrl: String(config.public.appUrl ?? '').replace(/\/$/, ''),
  }
}

/** Count one hit on a network limit for `who` (a member id, or an IP for invite previews). 429 once it's passed. */
export async function networkRateLimit(event: NetworkEventArg, who: string, bucket: NetworkLimit, message: string) {
  await st8SocialServer.limitRate(event, `network:${bucket}:${who}`, useSt8Network().limits[bucket], message)
}

/**
 * How `me` stands with each of `ids`. A block by the other person reads as `none` here: callers that list people should
 * drop everyone in `st8SocialServer.blockedWith(me)` as well.
 */
export async function networkStates(me: string, ids: string[]): Promise<Map<string, ConnectionState>> {
  const edges = await edgesBetween(me, ids)
  return new Map(ids.map((id) => {
    const state = stateFor(me, edges.get(id) ?? null)
    return [id, state === 'hidden' ? 'none' : state]
  }))
}

/** `me`'s accepted connections (ids, any app), most recent first. */
export async function networkConnections(me: string): Promise<string[]> {
  return (await acceptedNeighbours(me)).map((n) => n.id)
}

/** For each of `ids`: the connections they share with `me`. */
export async function networkMutuals(me: string, ids: string[]): Promise<Map<string, string[]>> {
  return mutualsOf(me, ids)
}

/** People two steps from `me` (connections of connections, not `me` or my connections), with how many paths lead there. */
export async function networkSecondDegree(me: string): Promise<Map<string, number>> {
  return secondDegree(me)
}
