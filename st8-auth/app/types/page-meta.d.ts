declare module '#app' {
  interface PageMeta {
    /** false = reachable without signing in (the auth middleware skips it). */
    auth?: boolean
  }
}

export {}
