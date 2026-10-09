import type { InjectionKey } from 'vue'
import { toast } from 'vue-sonner'
import type { ModerationAction, SocialComment, SocialPerson, SocialViewer, ThreadDelta, ThreadPage, ThreadSummary } from '../../shared/types/social'

// The state behind one SocialThread: a flat map of loaded comments, the visible totals per group, and the actions.
// Comments render from the map as a tree (top level newest first; replies oldest first under their group). Realtime:
// a version bump on the thread fetches only what changed since the cursor, plus the ids still visible, so comments
// hidden or deleted elsewhere disappear here too. Writes are optimistic and roll back with a toast on failure.

export interface ThreadState {
  collection: string
  item: string
  comments: Map<string, SocialComment>
  pending: Set<string>
  groups: Record<string, number>
  expanded: Set<string>
  viewer: SocialViewer | null
  summary: ThreadSummary | undefined
  loading: boolean
  error: string | null
  next: string | null
  replyingTo: string | null
  editing: string | null
}

export type ThreadApi = ReturnType<typeof createThread>

export const SOCIAL_THREAD: InjectionKey<ThreadApi> = Symbol('st8-social-thread')

const byNewest = (a: SocialComment, b: SocialComment) => b.createdAt.localeCompare(a.createdAt)
const byOldest = (a: SocialComment, b: SocialComment) => a.createdAt.localeCompare(b.createdAt)

let tempSeq = 0

export function createThread(collection: string, item: string) {
  const key = targetKey(collection, item)
  const targets = useSocialTargets()
  const summary = useSocialSummary(collection, item)
  const { user } = useUserSession()

  const state = reactive<ThreadState>({
    collection,
    item,
    comments: new Map(),
    pending: new Set(),
    groups: {},
    expanded: new Set(),
    viewer: null,
    summary: undefined,
    loading: true,
    error: null,
    next: null,
    replyingTo: null,
    editing: null,
  })
  let cursor: string | null = null

  // ── Tree ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Depth-1 parents the viewer can't see but whose replies they can: shown as "not available" placeholders. */
  const placeholders = computed(() => {
    const out = new Map<string, SocialComment>()
    for (const c of state.comments.values()) {
      if (c.depth < 2 || !c.group || state.comments.has(c.group) || out.has(c.group) || !c.root || !state.comments.has(c.root)) continue
      out.set(c.group, {
        ...c,
        id: c.group,
        parent: c.root,
        depth: 1,
        group: c.root,
        replyTo: null,
        author: null,
        body: '',
        mentions: [],
        status: 'unavailable',
        replyCount: 0,
        reactions: {},
        reactionTotal: 0,
        myReaction: null,
        mine: false,
        can: { edit: false, delete: false, reply: false, react: false, report: false, moderate: false },
      })
    }
    return out
  })

  const top = computed(() => [...state.comments.values()].filter((c) => c.depth === 0).sort(byNewest))

  function children(groupId: string): SocialComment[] {
    const list = [...state.comments.values(), ...placeholders.value.values()].filter((c) => c.group === groupId && c.depth > 0)
    // A reply only renders under a parent that is itself on screen.
    return list.sort(byOldest)
  }

  /** Visible replies in a group that aren't loaded yet ("View N more replies"). */
  function hidden(groupId: string) {
    const loaded = [...state.comments.values()].filter((c) => c.group === groupId && !state.pending.has(c.id)).length
    return Math.max(0, (state.groups[groupId] ?? 0) - loaded)
  }

  const moreTop = computed(() => Math.max(0, (state.groups.top ?? 0) - top.value.filter((c) => !state.pending.has(c.id)).length))

  // ── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────
  function absorbSummary(s: ThreadSummary) {
    targets.setSummary(s)
  }

  async function load() {
    state.loading = true
    state.error = null
    try {
      const page = await $fetch<ThreadPage>('/api/social/comments', { query: { collection, item, limit: 10 } })
      state.comments = new Map(page.comments.map((c) => [c.id, c]))
      state.groups = page.groups
      state.next = page.next
      state.viewer = page.viewer
      targets.setViewer(page.viewer)
      cursor = page.cursor
      absorbSummary(page.thread)
    } catch (err) {
      state.error = socialError(err, 'Comments couldn’t be loaded.')
    } finally {
      state.loading = false
    }
  }

  async function loadOlder() {
    if (!state.next) return
    try {
      const page = await $fetch<ThreadPage>('/api/social/comments', { query: { collection, item, limit: 10, before: state.next } })
      for (const c of page.comments) state.comments.set(c.id, c)
      state.groups = { ...state.groups, ...page.groups, top: page.groups.top ?? state.groups.top ?? 0 }
      state.next = page.next
    } catch (err) {
      toast.error(socialError(err, 'More comments couldn’t be loaded.'))
    }
  }

  async function expand(groupId: string) {
    try {
      const res = await $fetch<{ comments: SocialComment[], total: number }>(`/api/social/comments/${groupId}/replies`)
      for (const c of res.comments) state.comments.set(c.id, c)
      state.groups = { ...state.groups, [groupId]: res.total }
      state.expanded.add(groupId)
    } catch (err) {
      toast.error(socialError(err, 'Replies couldn’t be loaded.'))
    }
  }

  let deltaRunning = false
  let deltaAgain = false
  async function refresh() {
    if (state.loading) return
    if (!cursor) return void load()
    if (deltaRunning) {
      deltaAgain = true
      return
    }
    deltaRunning = true
    try {
      do {
        deltaAgain = false
        const roots = top.value.filter((c) => !state.pending.has(c.id)).map((c) => c.id)
        const delta: ThreadDelta = await $fetch<ThreadDelta>('/api/social/comments', { query: { collection, item, since: cursor, roots: roots.join(',') } })
        const present = new Set(delta.present)
        for (const c of [...state.comments.values()]) {
          if (state.pending.has(c.id)) continue
          const root = c.depth ? c.root : c.id
          if (root && roots.includes(root) && !present.has(c.id)) state.comments.delete(c.id)
        }
        for (const c of delta.changed) state.comments.set(c.id, c)
        state.groups = { ...state.groups, ...delta.groups }
        state.viewer = delta.viewer
        cursor = delta.cursor ?? cursor
        absorbSummary(delta.thread)
      } while (deltaAgain)
    } catch (err) {
      console.warn('[st8-social] thread refresh failed:', (err as Error)?.message ?? err)
    } finally {
      deltaRunning = false
    }
  }

  // ── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────
  const me = computed<SocialPerson | null>(() => user.value
    ? { id: user.value.id, name: [user.value.first_name, user.value.last_name].filter(Boolean).join(' ') || 'You', first_name: user.value.first_name, last_name: user.value.last_name, avatar: user.value.avatar, color: user.value.profile?.industry?.color ?? null, title: null }
    : null)

  async function post(body: string, mentions: SocialPerson[], parent: SocialComment | null): Promise<boolean> {
    const id = `temp-${++tempSeq}`
    const group = parent ? (parent.depth >= 2 ? parent.group : parent.id) : null
    const temp: SocialComment = {
      id,
      thread: parent?.thread ?? '',
      parent: parent?.id ?? null,
      root: parent ? (parent.root ?? parent.id) : null,
      depth: parent ? Math.min(parent.depth + 1, 2) : 0,
      group,
      replyTo: parent && parent.depth >= 2 ? parent.author : null,
      author: me.value,
      body,
      mentions,
      status: 'published',
      autoHidden: false,
      createdAt: new Date().toISOString(),
      editedAt: null,
      replyCount: 0,
      reactions: {},
      reactionTotal: 0,
      myReaction: null,
      mine: true,
      can: { edit: false, delete: false, reply: false, react: false, report: false, moderate: false },
    }
    state.pending.add(id)
    state.comments.set(id, temp)
    if (parent) state.replyingTo = null
    try {
      const res = await $fetch<{ comment: SocialComment, thread: ThreadSummary }>('/api/social/comments', {
        method: 'POST',
        body: { collection, item, body, parent: parent?.id ?? undefined },
      })
      state.comments.delete(id)
      state.pending.delete(id)
      if (!state.comments.has(res.comment.id)) {
        const g = res.comment.group ?? 'top'
        state.groups = { ...state.groups, [g]: (state.groups[g] ?? 0) + 1 }
      }
      state.comments.set(res.comment.id, res.comment)
      absorbSummary(res.thread)
      return true
    } catch (err) {
      state.comments.delete(id)
      state.pending.delete(id)
      if (parent) state.replyingTo = parent.id
      toast.error(socialError(err, 'Your comment wasn’t posted.'))
      return false
    }
  }

  async function edit(comment: SocialComment, body: string): Promise<boolean> {
    const before = comment
    state.comments.set(comment.id, { ...comment, body, editedAt: new Date().toISOString() })
    state.editing = null
    try {
      const res = await $fetch<{ comment: SocialComment }>(`/api/social/comments/${comment.id}`, { method: 'PATCH', body: { body } })
      state.comments.set(res.comment.id, res.comment)
      return true
    } catch (err) {
      state.comments.set(before.id, before)
      state.editing = before.id
      toast.error(socialError(err, 'Your edit wasn’t saved.'))
      return false
    }
  }

  async function remove(comment: SocialComment) {
    const before = comment
    const tombstone: SocialComment = { ...comment, status: 'deleted', body: '', mentions: [], author: null, can: { edit: false, delete: false, reply: false, react: false, report: false, moderate: false } }
    if (comment.replyCount > 0) state.comments.set(comment.id, tombstone)
    else state.comments.delete(comment.id)
    try {
      const res = await $fetch<{ mode: 'hard' | 'tombstone', thread: ThreadSummary | null }>(`/api/social/comments/${comment.id}`, { method: 'DELETE' })
      if (res.mode === 'hard') {
        state.comments.delete(comment.id)
        const g = comment.group ?? 'top'
        state.groups = { ...state.groups, [g]: Math.max(0, (state.groups[g] ?? 1) - 1) }
      } else {
        state.comments.set(comment.id, tombstone)
      }
      if (res.thread) absorbSummary(res.thread)
      toast.success('Comment deleted.')
    } catch (err) {
      state.comments.set(before.id, before)
      toast.error(socialError(err, 'The comment wasn’t deleted.'))
    }
  }

  async function moderate(comment: SocialComment, action: ModerationAction, reason?: string) {
    try {
      const res = await $fetch<{ comment: SocialComment }>(`/api/social/comments/${comment.id}/moderate`, { method: 'POST', body: { action, reason } })
      state.comments.set(res.comment.id, res.comment)
      toast.success({ hide: 'Comment hidden. Only its author and moderators can see it.', unhide: 'Comment restored.', remove: 'Comment removed.' }[action])
    } catch (err) {
      toast.error(socialError(err))
    }
  }

  async function setLocked(locked: boolean) {
    try {
      absorbSummary(await $fetch<ThreadSummary>('/api/social/threads/lock', { method: 'POST', body: { collection, item, locked } }))
      toast.success(locked ? 'Comments are closed.' : 'Comments are open again.')
    } catch (err) {
      toast.error(socialError(err))
    }
  }

  /** A reaction on a comment changed (SocialReactionBar in state mode). */
  function patch(id: string, changes: Partial<SocialComment>) {
    const c = state.comments.get(id)
    if (c) state.comments.set(id, { ...c, ...changes })
  }

  if (import.meta.client) {
    const off = targets.onThreadChange(key, () => void refresh())
    onScopeDispose(off)
  }

  return { state, summary, top, children, hidden, moreTop, placeholders, load, loadOlder, expand, refresh, post, edit, remove, moderate, setLocked, patch }
}
