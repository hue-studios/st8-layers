/** `const avatarUrl = useAvatarUrl(); avatarUrl(user.avatar, 64)`: see avatarUrlFor (shared/utils/avatar-url.ts). */
export function useAvatarUrl() {
  const config = useRuntimeConfig().public
  const pattern = String(config.st8Auth.avatarUrl ?? '/api/avatars/:id?size=:px')
  const directusUrl = String(config.directusUrl ?? '')
  return (id: string, px = 128) => avatarUrlFor(id, px, pattern, directusUrl)
}
