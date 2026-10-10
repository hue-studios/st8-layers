import { deleteItems } from '@directus/sdk'
import { rows, sys } from './core'
import { touchThread } from './counters'
import { findThread } from './threads'

// What a host calls when one of its targets goes away for good (Insider: an author deletes a post). Reports and the
// moderation log keep their snapshots; everything else hanging off the target in this app goes.

async function deleteAll(collection: string, ids: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < ids.length; i += 100) await sys().request(deleteItems(collection as any, ids.slice(i, i + 100) as any))
}

/**
 * Delete a target's conversation in this app: its comments (and their reactions and notifications), its reactions, the
 * notifications about it and its thread. The thread's version is bumped first, so every open view refetches and finds
 * the target gone. Returns how many comments went with it.
 */
export async function deleteTargetSocial(collection: string, item: string): Promise<{ comments: number }> {
  const app = useSt8Social().app
  const thread = await findThread(collection, item)
  let commentIds: string[] = []
  if (thread) {
    await touchThread(thread.id).catch(() => null)
    commentIds = (await rows<{ id: string }>(sys(), 'comments', { fields: ['id'], filter: { thread: { _eq: thread.id } }, limit: -1 })).map((c) => c.id)
  }
  const onComments = commentIds.length ? [{ target_collection: { _eq: 'comments' }, target_item: { _in: commentIds } }] : []
  const [reactions, notifications] = await Promise.all([
    rows<{ id: string }>(sys(), 'reactions', {
      fields: ['id'],
      filter: { app: { _eq: app }, _or: [{ target_collection: { _eq: collection }, target_item: { _eq: item } }, ...onComments] },
      limit: -1,
    }),
    rows<{ id: string }>(sys(), 'notifications', {
      fields: ['id'],
      filter: { app: { _eq: app }, _or: [{ target_collection: { _eq: collection }, target_item: { _eq: item } }, ...onComments] },
      limit: -1,
    }),
  ])
  await deleteAll('reactions', reactions.map((r) => r.id))
  await deleteAll('notifications', notifications.map((n) => n.id))
  // Comments go with their thread (comments.thread cascades).
  if (thread) await deleteAll('threads', [thread.id])
  return { comments: commentIds.length }
}
