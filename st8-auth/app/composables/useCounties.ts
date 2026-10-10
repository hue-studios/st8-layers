import type { CountySummary } from '../../shared/types/profile'

/** The published ST8 counties, shared by every caller on the page (one request). */
export function useCounties() {
  return useFetch('/api/counties', { key: 'counties', dedupe: 'defer', default: () => [] as CountySummary[] })
}
