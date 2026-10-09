import { introduce } from '../../lib/actions'
import { noStore, readJson } from '../../lib/http'

// Introduce two of your connections: { a, b, note? }. Both are notified; either can then ask to connect.
export default defineEventHandler(async (event) => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  const body = await readJson<{ a: string, b: string, note: string }>(event)
  return introduce(event, ctx, body.a, body.b, body.note)
})
