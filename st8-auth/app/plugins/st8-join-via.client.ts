// Another ST8 app's join link (`?via=summit:events:12`, from its cross-app teaser) on any page a signed-out visitor
// lands on: keep it for a day so sign-up or sign-in can record where the new member came from
// (server/utils/join-via.ts checks it and writes it only on a membership that sign-in creates).
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const { loggedIn } = useUserSession()
  const keep = (via: unknown) => {
    if (loggedIn.value || typeof via !== 'string' || !/^[a-z]+:[a-z_]{1,40}:[A-Za-z0-9-]{1,64}$/.test(via)) return
    useCookie('st8_via', { maxAge: 60 * 60 * 24, sameSite: 'lax', path: '/' }).value = via
  }
  keep(router.currentRoute.value.query.via)
  router.afterEach((to) => keep(to.query.via))
})
