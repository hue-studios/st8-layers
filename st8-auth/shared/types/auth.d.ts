// The sealed session (nuxt-auth-utils). `user` and any top-level field are readable in the browser
// (GET /api/_auth/session); `secure` never leaves the server. Directus tokens live only in `secure`.
declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    /** Directus file id */
    avatar: string | null
    /** The global ST8 profile, summarised for the shell (avatar ring, menu). Null until the row exists. */
    profile: SessionProfile | null
  }

  interface SecureSessionData {
    access_token: string
    refresh_token: string
    /** Epoch ms when access_token expires. */
    expires_at: number
    /** This app's membership, re-read on heartbeat (memberships.status gates sign-in). */
    membership: SessionMembership | null
    /** Epoch ms of the last membership/user re-read. */
    checked_at: number
  }

  interface UserSession {
    loggedInAt?: number
  }
}

export interface SessionProfile {
  id: string
  headline: string | null
  industry: { id: number, name: string, color: string | null } | null
}

export interface SessionMembership {
  app: 'insider' | 'summit' | 'portal'
  role: 'member' | 'contributor' | 'moderator' | 'admin'
  status: 'active' | 'suspended'
}
