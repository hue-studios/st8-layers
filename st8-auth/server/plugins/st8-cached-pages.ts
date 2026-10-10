// Pages a host caches for everyone (route rules `isr`, `swr` or `cache`, e.g. Summit's content pages) must render the
// same for every visitor, so they never see a session on the server: their cookies are dropped before rendering, and
// the request is marked cached, which tells nuxt-auth-utils to load the session in the browser after hydration
// instead of serializing it into the page payload. API routes are left alone (they set their own cache headers), and
// so is any page without such a rule (Insider has none).
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (event.path.startsWith('/api/') || event.path.startsWith('/_')) return
    const rules = getRouteRules(event)
    if (!rules.isr && !rules.swr && !rules.cache) return
    event.context.cache ??= {}
    delete event.node.req.headers.cookie
  })
})
