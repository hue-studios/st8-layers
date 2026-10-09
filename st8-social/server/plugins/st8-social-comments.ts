import { and, byId, isSocialId, notBlocked, rows, socialContext, sys } from '../lib/core'
import { resolvePeople } from '../lib/people'

// The layer's own target: comments can be reacted to and reported (not commented on: replies are comments). A comment
// is visible when the member's own Directus token can read it as published, its author isn't blocked, and the target
// its thread belongs to is visible to them. Links to a comment go through its thread's target (notifications.ts).
export default defineNitroPlugin(() => {
  registerSocialTarget({
    collection: 'comments',
    label: 'comment',
    reactions: true,
    reports: true,

    async visible(items, { event, viewer }) {
      const ids = items.filter(isSocialId)
      if (!ids.length) return new Set()
      const ctx = await socialContext(event)
      const found = await rows<{ id: string, thread: { target_collection: string, target_item: string } | null }>(sys(), 'comments', {
        fields: ['id', { thread: ['target_collection', 'target_item'] }],
        filter: { id: { _in: ids } },
        limit: -1,
      })
      // Readable by the member (their policy), published, author not blocked.
      const readable = new Set((await rows<{ id: string }>(ctx.user, 'comments', {
        fields: ['id'],
        filter: and({ id: { _in: ids }, status: { _eq: 'published' } }, notBlocked('author', ctx.blocked)),
        limit: -1,
      })).map((c) => c.id))
      // …and on a target they can see.
      const byCollection = new Map<string, string[]>()
      for (const c of found) if (c.thread) byCollection.set(c.thread.target_collection, [...(byCollection.get(c.thread.target_collection) ?? []), c.thread.target_item])
      const targetOk = new Set<string>()
      for (const [collection, targetItems] of byCollection) {
        const def = socialTarget(collection)
        if (!def || collection === 'comments') continue
        for (const item of await def.visible([...new Set(targetItems)], { event, viewer })) targetOk.add(`${collection}:${item}`)
      }
      return new Set(found.filter((c) => readable.has(c.id) && c.thread && targetOk.has(`${c.thread.target_collection}:${c.thread.target_item}`)).map((c) => c.id))
    },

    async owners(items) {
      const found = await rows<{ id: string, author: string | null }>(sys(), 'comments', { fields: ['id', 'author'], filter: { id: { _in: items.filter(isSocialId) } }, limit: -1 })
      return new Map(found.filter((c) => c.author).map((c) => [c.id, c.author!]))
    },

    async snapshot(item) {
      const c = await byId<{ id: string, body: string | null, author: string | null, date_created: string, thread: { target_collection: string, target_item: string } | null }>(
        sys(), 'comments', item, ['id', 'body', 'author', 'date_created', 'thread.target_collection', 'thread.target_item'],
      )
      if (!c) return null
      const author = c.author ? (await resolvePeople([c.author])).get(c.author) : null
      return {
        kind: 'comment',
        author: c.author,
        author_name: author?.name ?? null,
        body: c.body,
        created: c.date_created,
        on: c.thread ? `${c.thread.target_collection}:${c.thread.target_item}` : null,
      }
    },
  })
})

