// Web Push shapes shared by the server, the service worker (public/st8-sw.js reads the same fields) and the switch.

/** What a push carries, encrypted; the lock screen shows `title` and `body`. Never a comment or post snippet. */
export interface PushMessage {
  v: 1
  /** The notification's id: tapping marks it read. */
  id: string
  /** The app's name. */
  title: string
  /** "Jen Lee replied to your comment." Moderation and report pushes name nobody. */
  body: string
  /** Where tapping goes (same origin, a path). */
  url: string
  /** A newer push with the same tag replaces the older one on the device. */
  tag: string
  /** The recipient's unread count in this app, for the app icon's badge. */
  count: number
  icon?: string
  badge?: string
  /** Epoch ms the notification was created. */
  ts: number
}

/** The push routes' answer: push is set up in this app, and on for this device and member. */
export interface PushState {
  configured: boolean
  enabled: boolean
}
