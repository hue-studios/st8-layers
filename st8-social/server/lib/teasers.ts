import type { ReactionCounts, ReactionKey, SocialTargetRef, SocialTeaser } from '../../shared/types/social'
import type { SocialContext, SocialEvent } from './core'
import { limitRate, rows, sys } from './core'
import { topReactions } from '../../shared/utils/social'

// Cross-app teasers (docs/go-live-plan.md Phase 7): another app's activity on a shared row, as a reason to join it.
// Members' tokens can't read other apps' threads (by design), so the totals are read with the server account and only
// counts and reaction keys leave the server: no names, ids or text. People blocked with the viewer (either way) are
// left out, and an app below the threshold is left out entirely, so a count on a quiet row can't point at a person.

interface Participant {
  user: string
  comments: number
  reaction: ReactionKey | null
}

const APPS = ['insider', 'summit', 'portal']

/** The apps whose totals this app shows (public.st8Social.teasers), never itself. */
export function teaserApps(): string[] {
  const list = (useRuntimeConfig().public.st8Social as { teasers?: { app?: string }[] } | undefined)?.teasers ?? []
  const self = useSt8Social().app
  return [...new Set(list.map((t) => t.app).filter((a): a is string => !!a && APPS.includes(a) && a !== self))]
}

/** Who took part in `app`'s thread on a target, read with the server account; cached for two minutes. */
const participants = defineCachedFunction(
  async (app: string, collection: string, item: string): Promise<Participant[]> => {
    const [thread] = await rows<{ id: string }>(sys(), 'threads', { fields: ['id'], filter: { unique_key: { _eq: `${app}:${collection}:${item}` } }, limit: 1 })
    const [comments, reactions] = await Promise.all([
      thread
        ? rows<{ author: string | null }>(sys(), 'comments', { fields: ['author'], filter: { thread: { _eq: thread.id }, status: { _eq: 'published' } }, limit: -1 })
        : Promise.resolve([]),
      rows<{ user: string | null, reaction: ReactionKey }>(sys(), 'reactions', {
        fields: ['user', 'reaction'],
        filter: { app: { _eq: app }, target_collection: { _eq: collection }, target_item: { _eq: item } },
        limit: -1,
      }),
    ])
    const people = new Map<string, Participant>()
    const of = (user: string) => people.get(user) ?? people.set(user, { user, comments: 0, reaction: null }).get(user)!
    for (const c of comments) if (c.author) of(c.author).comments++
    for (const r of reactions) if (r.user) of(r.user).reaction = r.reaction
    return [...people.values()]
  },
  { name: 'st8-social-teasers', maxAge: 120, getKey: (app: string, collection: string, item: string) => `${app}:${collection}:${item}` },
)

/** Teasers for the targets the viewer can see, from every configured app at or above the threshold. */
export async function teasersFor(event: SocialEvent, ctx: SocialContext, refs: SocialTargetRef[]): Promise<Record<string, SocialTeaser[]>> {
  await limitRate(event, `teasers:${ctx.me}`, useSt8Social().limits.teasers, 'You’re loading a lot of activity quickly.')
  const apps = teaserApps()
  const out: Record<string, SocialTeaser[]> = {}
  if (!apps.length || !refs.length) return out

  // Visibility, one call per collection (as for summaries): a target the viewer can't see gets nothing.
  const byCollection = new Map<string, string[]>()
  for (const r of refs) if (socialTarget(r.collection)) byCollection.set(r.collection, [...new Set([...(byCollection.get(r.collection) ?? []), r.item])])
  const visible: SocialTargetRef[] = []
  await Promise.all([...byCollection].map(async ([collection, items]) => {
    const ok = await socialTarget(collection)!.visible(items, { event, viewer: ctx.me })
    for (const item of items) if (ok.has(item)) visible.push({ collection, item })
  }))

  const memberships = await rows<{ app: string, status: string }>(sys(), 'memberships', { fields: ['app', 'status'], filter: { user: { _eq: ctx.me }, app: { _in: apps } }, limit: -1 })
  const memberOf = new Set(memberships.filter((m) => m.status === 'active').map((m) => m.app))
  const threshold = useSt8Social().teaserThreshold
  const blocked = new Set(ctx.blocked)

  await Promise.all(visible.map(async ({ collection, item }) => {
    const list: SocialTeaser[] = []
    for (const app of apps) {
      const people = (await participants(app, collection, item)).filter((p) => !blocked.has(p.user))
      if (people.length < threshold) continue
      const counts: ReactionCounts = {}
      for (const p of people) if (p.reaction) counts[p.reaction] = (counts[p.reaction] ?? 0) + 1
      list.push({ app, people: people.length, comments: people.reduce((n, p) => n + p.comments, 0), reactions: topReactions(counts, 3), member: memberOf.has(app) })
    }
    if (list.length) out[`${collection}:${item}`] = list
  }))
  return out
}
