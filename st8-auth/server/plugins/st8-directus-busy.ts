// A busy Directus answers 503 (server/utils/directus-busy.ts); h3's errors carry no headers, so Retry-After is added
// here. The error hook runs before the error handler writes the response.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const e = error as { statusCode?: number, data?: { retryAfter?: number } }
    if (event && e.statusCode === 503 && e.data?.retryAfter && !event.node.res.headersSent) {
      setResponseHeader(event, 'Retry-After', e.data.retryAfter)
    }
  })
})
