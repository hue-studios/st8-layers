import type { MutualConnections } from '../../../shared/types/network'
import { isUserId, mutualsOf } from '../../lib/edges'
import { noStore } from '../../lib/http'
import { networkPeople } from '../../lib/people'

// The connections you share with a member (?user=). Never anyone else's whole network.
export default defineEventHandler(async (event): Promise<MutualConnections> => {
  noStore(event)
  const ctx = await st8SocialServer.socialContext(event)
  const user = String(getQuery(event).user ?? '').toLowerCase()
  if (!isUserId(user)) throw createError({ statusCode: 400, message: 'Pick a member.' })
  if (user === ctx.me) return { count: 0, people: [] }
  if (ctx.blocked.includes(user) || !(await st8SocialServer.activeMembers([user])).has(user)) {
    throw createError({ statusCode: 404, message: 'Member not found.' })
  }
  const ids = (await mutualsOf(ctx.me, [user])).get(user) ?? []
  const people = await networkPeople(ids)
  const list = ids.map((id) => people.get(id)).filter((p) => !!p)
  return { count: list.length, people: list.sort((a, b) => a.name.localeCompare(b.name)) }
})
