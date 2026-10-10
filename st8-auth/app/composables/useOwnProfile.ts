import type { OwnProfileResponse, ProfileUpdate } from '../../shared/types/profile'

/**
 * The signed-in member's profile (GET /api/profile), with the writes that change it. Every write returns the fresh
 * profile and re-reads the session, so the header avatar and name update at once.
 * Await it in a page to render with the data: `const { data, save } = await useOwnProfile()`.
 */
export async function useOwnProfile() {
  const { fetch: fetchSession } = useUserSession()
  const request = useFetch<OwnProfileResponse>('/api/profile', { key: 'own-profile', dedupe: 'defer' })

  async function apply(next: Promise<OwnProfileResponse>) {
    const res = await next
    request.data.value = res
    await fetchSession()
    return res
  }

  /** PATCH only what changed; nothing to send is a no-op. */
  function save(update: ProfileUpdate) {
    if (!Object.keys(update).length) return Promise.resolve(request.data.value!)
    return apply($fetch<OwnProfileResponse>('/api/profile', { method: 'PATCH', body: update }))
  }

  function uploadAvatar(image: Blob) {
    const form = new FormData()
    form.append('file', image, 'avatar')
    return apply($fetch<OwnProfileResponse>('/api/profile/avatar', { method: 'POST', body: form }))
  }

  function removeAvatar() {
    return apply($fetch<OwnProfileResponse>('/api/profile/avatar', { method: 'DELETE' }))
  }

  await request
  return { data: request.data, error: request.error, status: request.status, refresh: request.refresh, save, uploadAvatar, removeAvatar }
}
