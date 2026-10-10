// Profile input rules, shared by the server (PATCH /api/profile, the source of truth) and the forms (inline errors
// before a round trip). Every normaliser returns the stored value, null for "cleared", or throws ProfileInputError.
import type { OwnProfile, ProfileUpdate } from '../types/profile'

export const PROFILE_LIMITS = {
  name: 80,
  title: 120,
  headline: 140,
  company: 120,
  bio: 2000,
  url: 255,
  skills: 20,
  skill: 40,
} as const

/** Avatar uploads: what the server accepts (it re-encodes everything to WebP). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export class ProfileInputError extends Error {
  constructor(
    readonly field: keyof ProfileUpdate | null,
    message: string,
  ) {
    super(message)
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** One line of text: trimmed, inner whitespace collapsed, control characters dropped. '' → null. */
export function normalizeLine(field: keyof ProfileUpdate, value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ProfileInputError(field, `${label} must be text.`)
  const text = value.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  if (text.length > max) throw new ProfileInputError(field, `Keep ${label.toLowerCase()} under ${max} characters.`)
  return text || null
}

/** The bio: line breaks kept (at most one blank line in a row), other whitespace tidied. '' → null. */
export function normalizeBio(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ProfileInputError('bio', 'Your bio must be text.')
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length > PROFILE_LIMITS.bio) throw new ProfileInputError('bio', `Keep your bio under ${PROFILE_LIMITS.bio} characters.`)
  return text || null
}

/** Skills: trimmed, a leading # dropped, duplicates (any case) removed, at most PROFILE_LIMITS.skills. */
export function normalizeSkills(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new ProfileInputError('skills', 'Skills must be a list.')
  const seen = new Set<string>()
  const skills: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new ProfileInputError('skills', 'Each skill must be text.')
    const skill = item.replace(CONTROL, '').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '')
    if (!skill) continue
    if (skill.length > PROFILE_LIMITS.skill) throw new ProfileInputError('skills', `Keep each skill under ${PROFILE_LIMITS.skill} characters.`)
    const key = skill.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    skills.push(skill)
  }
  if (skills.length > PROFILE_LIMITS.skills) throw new ProfileInputError('skills', `Add up to ${PROFILE_LIMITS.skills} skills.`)
  return skills
}

function parseHttpUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  // A real public host: at least one dot, a TLD with a letter, no trailing dot.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]*[a-z][a-z0-9-]*$/i.test(url.hostname)) return null
  return url
}

/** A website: https:// added when missing, http(s) only, no credentials. '' → null. */
export function normalizeWebsite(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ProfileInputError('website', 'Enter a web address.')
  const raw = value.trim()
  if (!raw) return null
  const url = raw.length <= PROFILE_LIMITS.url ? parseHttpUrl(raw) : null
  if (!url) throw new ProfileInputError('website', 'Enter a web address, like example.com.')
  const href = url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href
  if (href.length > PROFILE_LIMITS.url) throw new ProfileInputError('website', 'That web address is too long.')
  return href
}

const LINKEDIN_KINDS = ['in', 'company', 'school', 'showcase', 'pub']
const LINKEDIN_HINT = 'Enter your LinkedIn profile, like linkedin.com/in/yourname.'

/**
 * A LinkedIn profile or page, stored as https://www.linkedin.com/<in|company|school|showcase|pub>/<slug>. Accepts a
 * full URL, one without https://, or a bare profile name ("jane-doe" → /in/jane-doe). Query and fragment are dropped.
 */
export function normalizeLinkedIn(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ProfileInputError('linkedin', LINKEDIN_HINT)
  const raw = value.trim().replace(/^@/, '')
  if (!raw) return null
  if (/^[a-z0-9-]{3,100}$/i.test(raw)) return `https://www.linkedin.com/in/${raw}`
  const url = raw.length <= PROFILE_LIMITS.url ? parseHttpUrl(raw) : null
  const host = url?.hostname.toLowerCase()
  if (!url || !host || (host !== 'linkedin.com' && !host.endsWith('.linkedin.com'))) throw new ProfileInputError('linkedin', LINKEDIN_HINT)
  const parts = url.pathname.split('/').filter(Boolean)
  const [kind, slug] = parts
  if (!kind || !slug || !LINKEDIN_KINDS.includes(kind.toLowerCase())) throw new ProfileInputError('linkedin', LINKEDIN_HINT)
  const path = kind.toLowerCase() === 'pub' ? parts.join('/') : `${kind.toLowerCase()}/${slug}`
  if (!/^[\w\-%./]+$/.test(path)) throw new ProfileInputError('linkedin', LINKEDIN_HINT)
  return `https://www.linkedin.com/${path}`
}

/**
 * Validate and normalise a PATCH /api/profile body. Only keys present in `input` come back, so a partial update never
 * clears what it didn't mention (64 partner profiles were migrated with company and counties already set).
 */
export function normalizeProfileUpdate(input: unknown, allowed: { industries: Set<number>, counties: Set<number> }): ProfileUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProfileInputError(null, 'Send the profile fields as an object.')
  const body = input as Record<string, unknown>
  const has = (key: keyof ProfileUpdate) => Object.hasOwn(body, key)
  const out: ProfileUpdate = {}

  for (const [key, label] of [['first_name', 'First name'], ['last_name', 'Last name']] as const) {
    if (!has(key)) continue
    const name = normalizeLine(key, body[key], PROFILE_LIMITS.name, label)
    if (!name) throw new ProfileInputError(key, `${label} can’t be empty.`)
    out[key] = name
  }
  if (has('title')) out.title = normalizeLine('title', body.title, PROFILE_LIMITS.title, 'Title')
  if (has('headline')) out.headline = normalizeLine('headline', body.headline, PROFILE_LIMITS.headline, 'Headline')
  if (has('company')) out.company = normalizeLine('company', body.company, PROFILE_LIMITS.company, 'Organization')
  if (has('bio')) out.bio = normalizeBio(body.bio)
  if (has('skills')) out.skills = normalizeSkills(body.skills)
  if (has('website')) out.website = normalizeWebsite(body.website)
  if (has('linkedin')) out.linkedin = normalizeLinkedIn(body.linkedin)

  if (has('industry')) {
    const id = body.industry
    if (id !== null && !(Number.isInteger(id) && allowed.industries.has(id as number))) throw new ProfileInputError('industry', 'Pick one of the listed industries.')
    out.industry = id as number | null
  }
  if (has('counties')) {
    const ids = body.counties
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && allowed.counties.has(id))) throw new ProfileInputError('counties', 'Pick from the listed counties.')
    out.counties = [...new Set(ids as number[])]
  }
  if (has('discoverable')) {
    if (typeof body.discoverable !== 'boolean') throw new ProfileInputError('discoverable', 'Discoverable must be on or off.')
    out.discoverable = body.discoverable
  }
  return out
}

/** Onboarding steps, in order, and the profile fields each one asks for. */
export const PROFILE_STEPS = [
  { key: 'work', title: 'Your work', fields: ['industry', 'company', 'title'] },
  { key: 'region', title: 'Where you work', fields: ['counties', 'linkedin', 'website'] },
  { key: 'about', title: 'About you', fields: ['avatar', 'bio', 'skills', 'discoverable'] },
] as const satisfies readonly { key: string, title: string, fields: readonly (keyof OwnProfile)[] }[]

export type ProfileStepKey = (typeof PROFILE_STEPS)[number]['key']

/** What a complete profile has, for the "finish your profile" prompt. Website and discoverability are optional. */
export const PROFILE_CHECKLIST = [
  { field: 'industry', label: 'Industry', step: 'work' },
  { field: 'company', label: 'Organization', step: 'work' },
  { field: 'title', label: 'Title', step: 'work' },
  { field: 'counties', label: 'Counties', step: 'region' },
  { field: 'linkedin', label: 'LinkedIn', step: 'region' },
  { field: 'avatar', label: 'Photo', step: 'about' },
  { field: 'bio', label: 'Bio', step: 'about' },
  { field: 'skills', label: 'Skills', step: 'about' },
] as const satisfies readonly { field: keyof OwnProfile, label: string, step: ProfileStepKey }[]

/** The checklist items a profile still lacks, in onboarding order. */
export function missingProfileFields(profile: OwnProfile) {
  return PROFILE_CHECKLIST.filter(({ field }) => {
    const value = profile[field]
    return Array.isArray(value) ? !value.length : !value
  })
}
