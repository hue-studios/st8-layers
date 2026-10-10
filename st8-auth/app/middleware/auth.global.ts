// Members-only pages (isMembersOnlyRoute: runtimeConfig.public.st8Auth.defaultAccess, publicRoutes / protectedRoutes,
// definePageMeta({ auth })) send a signed-out visitor to /login?redirect=<where they were going>.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  if (to.path === '/login' && loggedIn.value) return navigateTo(safeRedirect(to.query.redirect), { replace: true })
  if (loggedIn.value || !isMembersOnlyRoute(to)) return

  return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
})
