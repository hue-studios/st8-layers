import type { H3Event } from 'h3'
import type { SecureSessionData, UserSession } from '#auth-utils'

// Hooks other layers listen to. Server: `st8-auth:session-end` runs in endSession (sign-out, a suspension ending the
// session) before the cookie is cleared, with the session as it was. Client: `st8-auth:sign-out` runs in logout()
// before the server call, so the page can undo what belongs to this browser (st8-social unsubscribes push).

export interface St8SessionEnd {
  event: H3Event
  session: UserSession & { secure?: Partial<SecureSessionData> }
}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    'st8-auth:session-end': (ctx: St8SessionEnd) => void | Promise<void>
  }
}

declare module '#app' {
  interface RuntimeNuxtHooks {
    'st8-auth:sign-out': () => void | Promise<void>
  }
}
