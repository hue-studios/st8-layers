// The global profile as the browser sees it (docs/go-live-plan.md §2): directus_users basics (names, title, avatar)
// plus the member's `profiles` row. The same shapes in every ST8 app; never an email except on your own profile.

/** A published industry, as GET /api/industries returns it. */
export interface IndustrySummary {
  id: number
  name: string
  shortName: string | null
  slug: string
  /** Hex colour, e.g. "#35B7F9". Drives avatar rings and industry accents. */
  color: string
  description: string | null
}

/** A county, as GET /api/counties returns it. */
export interface CountySummary {
  id: number
  name: string
}

/** A person in a list: who they are and where they work. */
export interface MemberSummary {
  id: string
  first_name: string | null
  last_name: string | null
  title: string | null
  company: string | null
  /** Directus file id or URL. */
  avatar: string | null
  industry: Pick<IndustrySummary, 'name' | 'color' | 'slug'> | null
}

/** A member's profile as other members see it. */
export interface MemberProfile extends MemberSummary {
  headline: string | null
  website: string | null
  linkedin: string | null
  /** The counties they work in, by name. */
  counties: string[]
  bio: string | null
  skills: string[]
}

/** The signed-in member's own editable profile: directus_users basics plus their global `profiles` row. */
export interface OwnProfile {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  title: string | null
  /** Directus file id. */
  avatar: string | null
  headline: string | null
  company: string | null
  /** industries.id */
  industry: number | null
  /** counties.id */
  counties: number[]
  bio: string | null
  skills: string[]
  website: string | null
  linkedin: string | null
  /** Appear in member search. Profile pages are visible to members either way. */
  discoverable: boolean
}

/** The fields PATCH /api/profile accepts. Absent keys are left as they are. */
export type ProfileUpdate = Partial<Omit<OwnProfile, 'id' | 'email' | 'avatar'>>

/** GET/PATCH /api/profile and the avatar routes: the editable profile and how members see it. */
export interface OwnProfileResponse {
  profile: OwnProfile
  view: MemberProfile
}
