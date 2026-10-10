import type { OwnProfileResponse } from '../../../shared/types/profile'

// The signed-in member's own profile: the editable fields and how other members see it.
export default defineEventHandler(async (event): Promise<OwnProfileResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return readOwnProfile(await getCurrentUserId(event))
})
