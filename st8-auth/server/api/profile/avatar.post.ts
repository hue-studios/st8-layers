import { updateMe } from '@directus/sdk'
import type { OwnProfileResponse } from '../../../shared/types/profile'

// Upload a new avatar (multipart, field "file"). The server checks the size and the real image type, re-encodes it
// (server/utils/profiles.ts: encodeAvatar), stores it with the server account in the avatar folder, then sets it on
// the member's own user with their token. The avatar it replaces is deleted if this app uploaded it.
export default defineEventHandler(async (event): Promise<OwnProfileResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { me, directus } = await getUserClient(event)
  await enforceRateLimit(event, `avatar:user:${me}`, 20, 60 * 60)

  const tooLarge = () => createError({ statusCode: 413, message: `Choose a photo under ${AVATAR_MAX_BYTES / 1024 / 1024} MB.` })
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > AVATAR_MAX_BYTES + 64 * 1024) throw tooLarge()
  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file' && p.filename !== undefined)
  if (!file?.data.length) throw createError({ statusCode: 400, message: 'Choose a photo to upload.' })
  if (file.data.length > AVATAR_MAX_BYTES) throw tooLarge()
  if (!sniffImage(file.data)) throw createError({ statusCode: 415, message: 'Use a JPEG, PNG or WebP photo.' })

  const before = (await readOwnProfile(me)).profile.avatar
  const id = await uploadAvatarFile(await encodeAvatar(file.data))
  try {
    await directus.request(updateMe({ avatar: id }))
  } catch (err) {
    await deleteOldAvatar(id)
    const { status, message } = directusError(err)
    console.error('[profiles] setting avatar failed:', status, message)
    throw createError({ statusCode: status === 403 ? 403 : 502, message: 'We couldn’t set your photo. Please try again.' })
  }
  await deleteOldAvatar(before)
  await refreshSessionUser(event)
  return readOwnProfile(me)
})
