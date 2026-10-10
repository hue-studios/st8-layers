import { deleteFile, readFile, readItems, readUser, updateItem, updateMe, uploadFiles } from '@directus/sdk'
import type { CountySummary, IndustrySummary, MemberProfile, MemberSummary, OwnProfile, OwnProfileResponse, ProfileUpdate } from '../../shared/types/profile'

// The global profile, read and edited by its owner (docs/go-live-plan.md §2), the same in every ST8 app. Names, title
// and avatar stay on directus_users; everything else is on the `profiles` row (counties via profiles_counties). Reads
// use the server account (members can only read their own rows); the host decides who may see someone else's profile
// before it calls toMemberProfile. Input rules: shared/utils/profile.ts.

const USER_FIELDS = ['id', 'email', 'first_name', 'last_name', 'title', 'avatar', 'status'] as const
const PROFILE_FIELDS = [
  'id', 'headline', 'company', 'bio', 'skills', 'website', 'linkedin', 'discoverable',
  { industry: ['id', 'name', 'color'] },
  { counties: ['id', { counties_id: ['id', 'county'] }] },
] as const

export type ProfileUserRow = { id: string, email?: string | null, first_name?: string | null, last_name?: string | null, title?: string | null, avatar?: unknown, status?: string | null }
export type ProfileRecord = Awaited<ReturnType<typeof readProfileRecord>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** The user's `profiles` row with its industry and county links, or null. */
export async function readProfileRecord(userId: string) {
  const [row] = await getDirectus().request(readItems('profiles', { fields: [...PROFILE_FIELDS], filter: { user: { _eq: userId } }, limit: 1 }))
  return row ?? null
}

function industryOf(row: { industry?: unknown } | null) {
  const industry = row?.industry as { id: number, name?: string | null, color?: string | null } | null | undefined
  return industry && typeof industry === 'object' && industry.name ? industry : null
}

type CountyLink = { id: number, counties_id: { id: number, county?: string | null } | number | null }

/** The county links of a profiles row (any host schema types `counties` differently, so it's narrowed here). */
const countyLinks = (row: ProfileRecord): CountyLink[] =>
  ((row?.counties ?? []) as unknown[]).filter((l): l is CountyLink => !!l && typeof l === 'object')

function countiesOf(row: ProfileRecord): CountySummary[] {
  return countyLinks(row)
    .map((link) => (link.counties_id && typeof link.counties_id === 'object' ? link.counties_id : null))
    .filter((c): c is { id: number, county: string } => !!c?.county)
    .map((c) => ({ id: c.id, name: c.county.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const fileId = (avatar: unknown) => (typeof avatar === 'string' ? avatar : null)

export function toMemberSummary(user: ProfileUserRow, row: { company?: string | null, industry?: unknown } | null): MemberSummary {
  const industry = industryOf(row)
  return {
    id: user.id,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    title: user.title ?? null,
    company: row?.company ?? null,
    avatar: fileId(user.avatar),
    industry: industry ? { name: industry.name!, color: industry.color || '#6b7280', slug: slugify(industry.name!) } : null,
  }
}

export function toMemberProfile(user: ProfileUserRow, row: ProfileRecord): MemberProfile {
  return {
    ...toMemberSummary(user, row),
    headline: row?.headline ?? null,
    website: row?.website ?? null,
    linkedin: row?.linkedin ?? null,
    counties: countiesOf(row).map((c) => c.name),
    bio: row?.bio ?? null,
    skills: Array.isArray(row?.skills) ? row.skills : [],
  }
}

function toOwnProfile(user: ProfileUserRow, row: ProfileRecord): OwnProfile {
  return {
    id: user.id,
    email: (user.email ?? '').toLowerCase(),
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    title: user.title ?? null,
    avatar: fileId(user.avatar),
    headline: row?.headline ?? null,
    company: row?.company ?? null,
    industry: industryOf(row)?.id ?? null,
    counties: countiesOf(row).map((c) => c.id),
    bio: row?.bio ?? null,
    skills: Array.isArray(row?.skills) ? row.skills : [],
    website: row?.website ?? null,
    linkedin: row?.linkedin ?? null,
    discoverable: !!row?.discoverable,
  }
}

/** The signed-in member's profile, editable and as others see it. Creates the profiles row if it's missing. */
export async function readOwnProfile(userId: string): Promise<OwnProfileResponse> {
  let row = await readProfileRecord(userId)
  if (!row) {
    await ensureProfile(userId)
    row = await readProfileRecord(userId)
  }
  const user = (await getDirectus().request(readUser(userId, { fields: [...USER_FIELDS] }))) as ProfileUserRow
  return { profile: toOwnProfile(user, row), view: toMemberProfile(user, row) }
}

/** The ids PATCH /api/profile may set: published industries and counties (the layer's cached routes). */
export async function allowedProfileChoices() {
  const [industries, counties] = await Promise.all([$fetch<IndustrySummary[]>('/api/industries'), $fetch<CountySummary[]>('/api/counties')])
  return { industries: new Set(industries.map((i) => i.id)), counties: new Set(counties.map((c) => c.id)) }
}

const USER_KEYS = ['first_name', 'last_name', 'title'] as const
const PROFILE_KEYS = ['headline', 'company', 'industry', 'bio', 'skills', 'website', 'linkedin', 'discoverable'] as const

/**
 * Apply a normalised update. Names and title go through the member's own token (their policies allow updating
 * themselves, admins included); the profiles row and its county links through the server account, since members
 * have no write access to `profiles`. Keys absent from `update` are left alone.
 */
export async function applyProfileUpdate(event: AuthEvent, update: ProfileUpdate) {
  const { me, directus } = await getUserClient(event)
  const userPatch = Object.fromEntries(USER_KEYS.filter((k) => k in update).map((k) => [k, update[k]]))
  const profilePatch: Record<string, unknown> = Object.fromEntries(PROFILE_KEYS.filter((k) => k in update).map((k) => [k, update[k]]))

  if (Object.keys(userPatch).length) {
    try {
      await directus.request(updateMe(userPatch))
    } catch (err) {
      const { status, message } = directusError(err)
      console.error('[profiles] updateMe failed:', status, message)
      throw createError({ statusCode: status === 403 ? 403 : 502, message: status === 403 ? 'Your account can’t change its name or title here.' : 'We couldn’t save your name. Please try again.' })
    }
  }

  if (!Object.keys(profilePatch).length && !update.counties) return
  await ensureProfile(me)
  const row = await readProfileRecord(me)
  if (!row) throw createError({ statusCode: 500, message: 'Your profile could not be created.' })

  if (update.counties) {
    const links = countyLinks(row)
    const countyOf = (l: CountyLink) => (l.counties_id && typeof l.counties_id === 'object' ? l.counties_id.id : l.counties_id)
    const current = new Set(links.map(countyOf))
    const wanted = new Set(update.counties)
    const create = update.counties.filter((id) => !current.has(id)).map((id) => ({ counties_id: id }))
    const remove = links.filter((l) => !wanted.has(countyOf(l) ?? Number.NaN)).map((l) => l.id) // empty links go too
    if (create.length || remove.length) profilePatch.counties = { create, update: [], delete: remove }
  }
  if (!Object.keys(profilePatch).length) return
  await getDirectus().request(updateItem('profiles', row.id, profilePatch))
}

// ── Avatars ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Directus Files folder avatars go in: st8Auth.avatarFolder, else DIRECTUS_AVATAR_FOLDER (empty = the root). */
function avatarFolder(): string {
  const config = useRuntimeConfig()
  return config.st8Auth.avatarFolder || (config as { directusAvatarFolder?: string }).directusAvatarFolder || process.env.DIRECTUS_AVATAR_FOLDER || ''
}

/** JPEG, PNG or WebP by their magic bytes (the browser's declared type is ignored). */
export function sniffImage(data: Uint8Array): (typeof AVATAR_TYPES)[number] | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => data[i + j] === b)
  if (at(0, 0xFF, 0xD8, 0xFF)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return 'image/png'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/**
 * Re-encode an uploaded image as a WebP of at most 1024px, honouring EXIF rotation. sharp drops all metadata, so a
 * phone photo's GPS position never reaches Directus (whose files are publicly readable).
 */
export async function encodeAvatar(data: Uint8Array): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  try {
    return await sharp(data, { limitInputPixels: 50_000_000, failOn: 'error' })
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
  } catch {
    throw createError({ statusCode: 400, message: 'That image couldn’t be read. Try a JPEG, PNG or WebP photo.' })
  }
}

/** Upload with the server account into the avatar folder. Metadata stays anonymous: no names, no user id. */
export async function uploadAvatarFile(image: Buffer): Promise<string> {
  const folder = avatarFolder()
  const form = new FormData()
  if (folder) form.append('folder', folder)
  form.append('title', 'Member avatar')
  form.append('file', new Blob([new Uint8Array(image)], { type: 'image/webp' }), 'avatar.webp')
  const file = await getDirectus().request(uploadFiles(form))
  const id = (file as { id?: string })?.id
  if (!id) throw createError({ statusCode: 502, message: 'The upload didn’t return a file.' })
  return id
}

/**
 * Delete a replaced avatar, but only one an ST8 app uploaded: it must sit in the avatar folder, and the server account's
 * own file permissions decide the rest (Insider's may only delete files it uploaded). Avatars set in the Studio are left
 * alone. Best effort.
 */
export async function deleteOldAvatar(fileIdToDelete: string | null) {
  if (!fileIdToDelete) return
  const folder = avatarFolder()
  try {
    const file = await getDirectus().request(readFile(fileIdToDelete, { fields: ['id', 'folder'] }))
    if (!folder || file.folder !== folder) return
    await getDirectus().request(deleteFile(fileIdToDelete))
  } catch (err) {
    console.warn('[profiles] old avatar not deleted:', fileIdToDelete, directusError(err).message ?? err)
  }
}

/** The viewer's user id, if they hold an active membership in this app (sessions only exist for members). */
export async function requireActiveMember(event: AuthEvent): Promise<string> {
  const id = await getCurrentUserId(event)
  const membership = await getSessionMembership(event)
  if (membership?.status !== 'active') throw createError({ statusCode: 403, message: 'Only active members can see member profiles.' })
  return id
}

/** Turn a ProfileInputError into a 400 that names the field. */
export function profileInputError(err: unknown): never {
  if (err instanceof ProfileInputError) throw createError({ statusCode: 400, data: { field: err.field }, message: err.message })
  throw err
}
