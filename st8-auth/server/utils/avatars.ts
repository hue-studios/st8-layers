import { readUsers } from '@directus/sdk'

// Member photos live in the Member avatars folder, which isn't public, so apps show them through GET /api/avatars/<id>
// (server/api/avatars/[id].get.ts). By default only a signed-in visitor gets them; a host adds its own exceptions (an
// Insider invite landing shows the inviter's photo to whoever has the link) with registerAvatarAccess.

/**
 * May this request see avatar `id` without a session? Return true to allow, false to pass. Throwing (a 404, a 429)
 * ends the request.
 */
export type AvatarAccess = (event: AuthEvent, id: string) => boolean | Promise<boolean>

const exceptions: AvatarAccess[] = []

/** Let signed-out visitors see an avatar in a case the host decides (call it from a Nitro plugin). */
export function registerAvatarAccess(check: AvatarAccess) {
  exceptions.push(check)
}

export async function avatarAllowedWithoutSession(event: AuthEvent, id: string): Promise<boolean> {
  for (const check of exceptions) if (await check(event, id)) return true
  return false
}

/** Whether file `id` is someone's avatar (cached an hour): the route never serves any other file. */
export const isAvatarFile = defineCachedFunction(
  async (id: string): Promise<boolean> => {
    const rows = await getDirectus().request(readUsers({ fields: ['id'], filter: { avatar: { _eq: id } }, limit: 1 }))
    return rows.length > 0
  },
  { name: 'st8-is-avatar', maxAge: 60 * 60, getKey: (id: string) => id },
)
