// The browser-visible session user (nuxt-auth-utils exposes session.user to the client).
// Tokens never go here: Phase 2 keeps access/refresh tokens in session.secure (docs/go-live-plan.md §3).
declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    /** Directus file id */
    avatar: string | null
  }
}

export {}
