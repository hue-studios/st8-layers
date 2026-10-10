import type { OwnProfileResponse } from '../../../shared/types/profile'

// Update the signed-in member's profile. Partial: only the keys sent are changed. Inputs are validated and normalised
// by shared/utils/profile.ts; the session user is re-read so the header shows the change at once.
export default defineEventHandler(async (event): Promise<OwnProfileResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const me = await getCurrentUserId(event)
  await enforceRateLimit(event, `profile:user:${me}`, 120, 60 * 60)

  const body = await readBody(event)
  let update
  try {
    update = normalizeProfileUpdate(body, await allowedProfileChoices())
  } catch (err) {
    profileInputError(err)
  }
  await applyProfileUpdate(event, update)
  await refreshSessionUser(event)
  return readOwnProfile(me)
})
