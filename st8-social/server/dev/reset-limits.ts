import { forgetAllBlocks } from '../lib/core'

// Dev only (never in production builds): clears the social rate-limit counters, the network's withdraw cooldowns and the
// memoised blocks, so the probes can test the limits and then carry on, and see a block they made straight in Directus
// (not through /api/connections) at once. POST /api/social/dev/reset-limits
export default defineEventHandler(async (event) => {
  assertMethod(event, 'POST')
  await getCurrentUserId(event)
  const storage = useStorage()
  await storage.clear('st8-social-rate-limit')
  if (storage.getMounts('').some((m) => m.base.replace(/:$/, '') === 'st8-network-cooldown')) await storage.clear('st8-network-cooldown')
  forgetAllBlocks()
  return { ok: true }
})
