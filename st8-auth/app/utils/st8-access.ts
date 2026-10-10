import type { RouteLocationNormalized } from 'vue-router'

/**
 * Whether `route` needs a session (runtimeConfig.public.st8Auth.defaultAccess):
 * - 'members' (Insider): everything except `publicRoutes` and pages with definePageMeta({ auth: false });
 * - 'public' (Summit): only `protectedRoutes` and pages with definePageMeta({ auth: true }).
 * A route entry ending in '/' matches that path and everything under it; any other entry matches exactly.
 */
export function isMembersOnlyRoute(route: Pick<RouteLocationNormalized, 'path' | 'meta'>): boolean {
  if (route.meta.auth === false) return false
  const config = useRuntimeConfig().public.st8Auth
  const matches = (routes: string[]) =>
    routes.some((r) => (r.endsWith('/') ? route.path.startsWith(r) || route.path === r.slice(0, -1) : route.path === r))
  return config.defaultAccess === 'public'
    ? route.meta.auth === true || matches(config.protectedRoutes as string[])
    : !matches(config.publicRoutes as string[])
}
