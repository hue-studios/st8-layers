/**
 * Every /api request with a session re-checks the app membership (at most every 30 s per session, in
 * getSessionMembership), so a suspension ends a live session within 30 s of the member's next request, whichever route
 * it is, reads included. /api/auth/* is left to its own handlers (sign-in, sign-out, the heartbeat, the Flow's
 * sync-access); requests without a session pass through untouched.
 */
export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/') || path.startsWith('/api/auth/') || path.startsWith('/api/_')) return
  const session = await getUserSession(event)
  if (!session.user?.id || !session.secure?.access_token) return
  await getSessionMembership(event)
})
