/**
 * The URL of avatar `id` at about `px` pixels: the host's `public.st8Auth.avatarUrl` pattern (`:id`, `:px`; the default
 * is the layer's own '/api/avatars/:id?size=:px'), or, when that is empty, the file on Directus `/assets` (which only
 * works while the avatar folder is public). Full URLs pass through.
 */
export function avatarUrlFor(id: string, px: number, pattern: string, directusUrl: string): string {
  if (/^https?:\/\//.test(id)) return id
  if (pattern) return pattern.replace(':id', encodeURIComponent(id)).replace(':px', String(px))
  return `${directusUrl.replace(/\/$/, '')}/assets/${id}?width=${px}&height=${px}&fit=cover&format=webp`
}
