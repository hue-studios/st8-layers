import { readItems } from '@directus/sdk'
import type { CountySummary } from '../../shared/types/profile'

// The 9 ST8 counties, for the feed's county filter and (Phase 3) profile county picker.
export default defineCachedEventHandler(
  async (): Promise<CountySummary[]> => {
    const rows = await getDirectus().request(
      readItems('counties', { fields: ['id', 'county'], filter: { status: { _eq: 'published' } }, sort: ['sort', 'county'], limit: -1 }),
    )
    return rows.filter((row) => row.county).map((row) => ({ id: row.id, name: row.county!.trim() }))
  },
  { name: 'counties', maxAge: 60 * 60, staleMaxAge: 60 * 60 * 24, swr: true },
)
