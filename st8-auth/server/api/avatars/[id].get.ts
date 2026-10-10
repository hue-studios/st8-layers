// A member's photo (public.st8Auth.avatarUrl points here). The Member avatars folder isn't public, so photos are served
// by the server account: to signed-in visitors, plus whatever the host allows without a session
// (registerAvatarAccess). Only files that are someone's avatar are served, so this never opens other files the server
// account can read. `?size=` is rounded up to 64, 128 or 256 px (a square WebP), so Directus keeps few variants. A new
// photo is a new file id, so browsers keep each one a week.
const SIZES = [64, 128, 256]

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const notFound = () => createError({ statusCode: 404, message: 'Not found' })
  if (!isUuid(id)) throw notFound()

  const session = await getUserSession(event)
  if (session.user?.id) {
    await getCurrentUserId(event)
  } else if (!(await avatarAllowedWithoutSession(event, id))) {
    throw createError({ statusCode: 401, message: 'Sign in to see this.' })
  }
  if (!(await isAvatarFile(id))) throw notFound()

  const wanted = Number(getQuery(event).size) || 128
  const size = SIZES.find((s) => s >= wanted) ?? SIZES.at(-1)!
  return streamDirectusAsset(event, id, {
    transform: { width: size, height: size, fit: 'cover', format: 'webp' },
    cache: 'private, max-age=604800, immutable',
  })
})
