// Where a new member came from (`memberships.joined_via`), e.g. "summit:events:12": another ST8 app's teaser linked
// here with `?via=` (layers/st8-social's SocialTeaser). The browser keeps it in a short-lived cookie through sign-up or
// sign-in (app/plugins/st8-join-via.client.ts); the server checks its shape and writes it only on the membership that
// sign-in creates. Members never write memberships, and an existing membership is never changed. It's attribution
// only: someone could hand-craft their own `?via=`, which costs nothing but a wrong count.

export const JOIN_VIA_COOKIE = 'st8_via'

const APPS = ['insider', 'summit', 'portal']

/** A valid `<app>:<collection>:<item>` from another app, with a collection this app accepts, or null. */
export function parseJoinVia(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 120) return null
  const m = /^([a-z]+):([a-z_]{1,40}):([A-Za-z0-9-]{1,64})$/.exec(value)
  if (!m) return null
  const [, app, collection] = m
  const { app: self, joinViaCollections } = useSt8Auth()
  if (!APPS.includes(app!) || app === self || !joinViaCollections.includes(collection!)) return null
  return value
}

/** The request's join source (from the cookie), cleared so it applies to one sign-in at most. */
export function takeJoinVia(event: AuthEvent): string | null {
  const raw = getCookie(event, JOIN_VIA_COOKIE)
  if (raw === undefined) return null
  deleteCookie(event, JOIN_VIA_COOKIE, { path: '/' })
  return parseJoinVia(raw)
}
