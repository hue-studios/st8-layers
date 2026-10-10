import type { IndustrySummary } from '../../shared/types/profile'

/**
 * The published ST8 industries, shared by every caller on the page (one request). Awaitable when a page needs the
 * data before rendering: `const { data: industries } = await useIndustries()`.
 */
export function useIndustries() {
  return useFetch('/api/industries', { key: 'industries', dedupe: 'defer', default: () => [] as IndustrySummary[] })
}
