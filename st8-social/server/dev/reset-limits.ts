// Dev only (never in production builds): clears the social rate-limit counters, so the probes can test the limits and
// then carry on. POST /api/social/dev/reset-limits
export default defineEventHandler(async (event) => {
  assertMethod(event, 'POST')
  await getCurrentUserId(event)
  await useStorage('st8-social-rate-limit').clear()
  return { ok: true }
})
