import type { OwnProfile, ProfileUpdate } from '../../shared/types/profile'

/** A profile as a form edits it: text fields are '' rather than null, so inputs can bind to them. */
export type ProfileDraft = { [K in keyof OwnProfile]: OwnProfile[K] extends string | null ? string : OwnProfile[K] }

export function toDraft(profile: OwnProfile): ProfileDraft {
  const copy: Record<string, unknown> = { ...structuredClone(toRaw(profile)) }
  for (const key of Object.keys(copy)) if (copy[key] === null && key !== 'industry') copy[key] = ''
  return copy as unknown as ProfileDraft
}

const comparable = (value: unknown) => {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return [...value].sort()
  return value ?? null
}

/** The fields among `keys` whose draft value differs from the saved one: what a form should PATCH. */
export function profileChanges(draft: ProfileDraft, saved: OwnProfile, keys: readonly (keyof ProfileUpdate)[]): ProfileUpdate {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (JSON.stringify(comparable(draft[key])) !== JSON.stringify(comparable(saved[key]))) out[key] = draft[key]
  }
  return out as ProfileUpdate
}

/** The message and field of a failed profile request (400s name the field). */
export function profileError(err: unknown, fallback: string) {
  if (err instanceof ProfileInputError) return { message: err.message, field: err.field }
  const e = err as { data?: { message?: string, data?: { field?: keyof ProfileUpdate } } }
  return { message: e?.data?.message || fallback, field: e?.data?.data?.field ?? null }
}

/**
 * Shrink a photo to at most `max` px and re-encode it as JPEG before upload: phone photos are often 5–12 MB, and
 * re-encoding drops their EXIF (location included). The server re-encodes again; this only saves the upload. Returns
 * the original file if the browser can't decode it, so the server's checks give the error.
 */
export async function downscaleImage(file: File, max = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    return blob ?? file
  } catch {
    return file
  }
}

/** Run the server's rules on an update before sending it. Returns the first problem by field, or null. */
export function checkProfileUpdate(update: ProfileUpdate, choices: { industries: { id: number }[], counties: { id: number }[] }) {
  try {
    normalizeProfileUpdate(update, { industries: new Set(choices.industries.map((i) => i.id)), counties: new Set(choices.counties.map((c) => c.id)) })
    return null
  } catch (err) {
    if (err instanceof ProfileInputError && err.field) return { [err.field]: err.message } as Partial<Record<keyof ProfileUpdate, string>>
    throw err
  }
}
