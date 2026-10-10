import { readItems } from '@directus/sdk'
import type { IndustrySummary } from '../../shared/types/profile'

// The 11 ST8 industries drive the industry circles, the Talk routes (/talk/[slug]) and every industry colour.
export default defineCachedEventHandler(
  async (): Promise<IndustrySummary[]> => {
    const rows = await getDirectus().request(
      readItems('industries', {
        fields: ['id', 'name', 'short_name', 'color', 'description'],
        filter: { status: { _eq: 'published' } },
        sort: ['sort', 'name'],
        limit: -1,
      }),
    )
    return rows
      .filter((row) => row.name)
      .map((row) => ({
        id: row.id,
        name: row.name!.trim(),
        shortName: row.short_name?.trim() || null,
        slug: slugify(row.name!),
        color: row.color || '#6b7280',
        description: row.description || null,
      }))
  },
  { name: 'industries', maxAge: 60 * 10, staleMaxAge: 60 * 60 * 24, swr: true },
)
