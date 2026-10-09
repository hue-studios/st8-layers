import { rows } from './edges'

// The Orbit ranking, no XP (docs/go-live-plan.md §4, agreed in Phase 5):
//
//   score = w.interaction · interaction + w.recency · recency + w.mutuals · mutuals      (weights normalised)
//
// - interaction: replies (and comments on the other's item), mentions and reactions between the two people in this
//   app, read from `notifications` (they record exactly those, actor → recipient, never across a block). Weighted 3 / 2
//   / 1, decayed by age (half-life), over a window, at most `dailyCap` points per pair per day, both directions alike;
//   normalised by the highest pair.
// - recency: how long ago the connection was made, as a half-life decay (1 = today).
// - mutuals: log(1 + shared connections), normalised by the highest.

const WEIGHTS: Record<string, number> = { reply: 3, mention: 2, reaction: 1 }
const DAY = 86_400_000

export interface RankInput { id: string, since: string, mutuals: number }

export async function rankConnections(me: string, list: RankInput[]): Promise<Map<string, number>> {
  const cfg = useSt8Network().ranking
  const now = Date.now()
  const ids = new Set(list.map((c) => c.id))

  // Interaction points per pair, per day, capped.
  const perDay = new Map<string, number>()
  if (ids.size) {
    const since = new Date(now - cfg.interactionWindowDays * DAY).toISOString()
    const notes = await rows<{ actor: string | null, recipient: string, type: string, date_created: string }>('notifications', {
      fields: ['actor', 'recipient', 'type', 'date_created'],
      filter: {
        app: { _eq: useSt8Network().app },
        type: { _in: Object.keys(WEIGHTS) },
        date_created: { _gte: since },
        _or: [{ actor: { _eq: me } }, { recipient: { _eq: me } }],
      },
      limit: -1,
    })
    for (const n of notes) {
      const other = n.actor === me ? n.recipient : n.actor
      if (!other || !ids.has(other)) continue
      const day = n.date_created.slice(0, 10)
      const key = `${other}|${day}`
      perDay.set(key, (perDay.get(key) ?? 0) + (WEIGHTS[n.type] ?? 0))
    }
  }
  const interaction = new Map<string, number>()
  const lnHalf = Math.LN2
  for (const [key, points] of perDay) {
    const [other, day] = key.split('|') as [string, string]
    const age = Math.max(0, now - Date.parse(`${day}T12:00:00Z`)) / DAY
    const value = Math.min(points, cfg.dailyCap) * Math.exp((-lnHalf * age) / cfg.interactionHalfLifeDays)
    interaction.set(other, (interaction.get(other) ?? 0) + value)
  }

  const maxInteraction = Math.max(0, ...interaction.values())
  const maxMutuals = Math.max(0, ...list.map((c) => Math.log1p(c.mutuals)))
  const total = cfg.interaction + cfg.recency + cfg.mutuals || 1
  const out = new Map<string, number>()
  for (const c of list) {
    const i = maxInteraction > 0 ? (interaction.get(c.id) ?? 0) / maxInteraction : 0
    const ageDays = Math.max(0, now - Date.parse(c.since)) / DAY
    const r = Math.exp((-lnHalf * ageDays) / cfg.recencyHalfLifeDays)
    const m = maxMutuals > 0 ? Math.log1p(c.mutuals) / maxMutuals : 0
    out.set(c.id, (cfg.interaction * i + cfg.recency * r + cfg.mutuals * m) / total)
  }
  return out
}
