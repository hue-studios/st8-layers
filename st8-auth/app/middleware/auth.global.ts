// Every route needs a session except runtimeConfig.public.st8Auth.publicRoutes (/login, /auth/*, /i/* by default) and
// pages with definePageMeta({ auth: false }). Signed-out visitors go to /login?redirect=<where they were going>.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  if (to.path === '/login' && loggedIn.value) return navigateTo(safeRedirect(to.query.redirect), { replace: true })
  if (to.meta.auth === false) return

  const routes = useRuntimeConfig().public.st8Auth.publicRoutes as string[]
  const isPublic = routes.some((r) => (r.endsWith('/') ? to.path.startsWith(r) || to.path === r.slice(0, -1) : to.path === r))
  if (isPublic || loggedIn.value) return

  return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
})
