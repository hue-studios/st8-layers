import { updateMe } from '@directus/sdk'
import type { OwnProfileResponse } from '../../../shared/types/profile'

// Remove the member's avatar (initials show instead). The file is deleted if this app uploaded it.
export default defineEventHandler(async (event): Promise<OwnProfileResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { me, directus } = await getUserClient(event)
  const before = (await readOwnProfile(me)).profile.avatar
  if (before) {
    await directus.request(updateMe({ avatar: null }))
    await deleteOldAvatar(before)
    await refreshSessionUser(event)
  }
  return readOwnProfile(me)
})
