// Browser-facing shapes of the st8-network layer (README.md). Never an email.

/** How the signed-in member stands with someone. A block by the other person is never reported: it reads as `none`. */
export type ConnectionState = 'none' | 'outgoing' | 'incoming' | 'connected' | 'blocked'

export type ConnectionAction = 'accept' | 'decline' | 'cancel' | 'remove'

export interface NetworkIndustry {
  id: number
  name: string
  color: string | null
}

/** A member as the network shows them: names, photo, work, industry colour. */
export interface NetworkPerson {
  id: string
  name: string
  first_name: string | null
  last_name: string | null
  /** Directus file id. */
  avatar: string | null
  title: string | null
  company: string | null
  headline: string | null
  industry: NetworkIndustry | null
  /** An active member of this app (their profile opens here). Connections are global, so someone may not be. */
  member: boolean
}

export interface NetworkConnection {
  person: NetworkPerson
  /** When the connection was made. */
  since: string
  /** Connections you share. */
  mutuals: number
  /** 0–1, the Orbit ranking (README.md, "Ranking"). The list is sorted by it, highest first. */
  score: number
}

export interface NetworkRequest {
  person: NetworkPerson
  /** When it was sent (or the block made). */
  at: string
}

/** GET /api/connections */
export interface NetworkOverview {
  connections: NetworkConnection[]
  incoming: NetworkRequest[]
  outgoing: NetworkRequest[]
  blocked: NetworkRequest[]
}

/** POST /api/connections, PATCH /api/connections/[user], PUT /api/connections/blocks */
export interface ConnectionResult {
  user: string
  state: ConnectionState
}

/** GET /api/connections/mutuals?user= */
export interface MutualConnections {
  count: number
  people: NetworkPerson[]
}

/** GET /api/invites, POST /api/invites/reset */
export interface MyInvite {
  code: string
  url: string
  expiresAt: string
}

/** GET /api/invites/[code]: the public invite landing. */
export interface InvitePreview {
  status: 'valid' | 'expired' | 'unknown'
  /** Only for a valid invite: who is inviting (no email, no ids beyond theirs). */
  inviter: Pick<NetworkPerson, 'id' | 'name' | 'first_name' | 'avatar' | 'title' | 'company' | 'headline' | 'industry'> | null
  /** Signed in only: it's your own link. */
  self?: boolean
  /** Signed in only: how you stand with the inviter. */
  state?: ConnectionState
}

/** POST /api/invites/redeem */
export interface InviteRedeemResult {
  state: ConnectionState
  /** True when you were already connected (nothing changed). */
  already: boolean
  inviter: NetworkPerson
}
