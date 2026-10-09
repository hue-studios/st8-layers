import type { SocialViewer, ThreadSummary } from '../../shared/types/social'

// Thread summaries for whatever is on screen, shared by every component that shows one. Components ask for a target
// with useSocialSummary(collection, item); requests made in the same tick are batched into one GET /api/social/threads,
// and one realtime subscription covers every target in view (threads: id, version). A version change refetches that
// target's summary, or tells the open thread to fetch its delta (onThreadChange). Client-only: counts render after
// hydration.

type Listener = () => void

const summaries = reactive(new Map<string, ThreadSummary>())
const viewer = ref<SocialViewer | null>(null)
const refs = new Map<string, number>() // key → components showing it
const listeners = new Map<string, Set<Listener>>() // key → open threads
const versions = new Map<string, number>()
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let resubTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null

function schedule(keys: Iterable<string>) {
  for (const k of keys) pending.add(k)
  if (!flushTimer) flushTimer = setTimeout(flush, 16)
}

async function flush() {
  flushTimer = null
  const keys = [...pending].filter((k) => refs.has(k))
  pending.clear()
  for (let i = 0; i < keys.length; i += 60) {
    const chunk = keys.slice(i, i + 60)
    try {
      const res = await $fetch<{ viewer: SocialViewer, threads: ThreadSummary[] }>('/api/social/threads', { query: { t: chunk } })
      viewer.value = res.viewer
      for (const s of res.threads) setSummary(s)
    } catch (err) {
      console.warn('[st8-social] summaries failed:', (err as Error)?.message ?? err)
    }
  }
}

function setSummary(s: ThreadSummary) {
  versions.set(s.key, s.version)
  summaries.set(s.key, s)
}

/** Keep the realtime subscription's filter equal to the targets in view (debounced; one subscription for all). */
function resubscribe() {
  if (resubTimer) clearTimeout(resubTimer)
  resubTimer = setTimeout(() => {
    resubTimer = null
    unsubscribe?.()
    unsubscribe = null
    const byCollection = new Map<string, string[]>()
    for (const key of refs.keys()) {
      const ref = parseTargetKey(key)
      if (ref) byCollection.set(ref.collection, [...(byCollection.get(ref.collection) ?? []), ref.item])
    }
    if (!byCollection.size) return
    const filter = { _or: [...byCollection].map(([collection, items]) => ({ target_collection: { _eq: collection }, target_item: { _in: items } })) }
    let inits = 0
    unsubscribe = useSocialRealtime().subscribe('threads', { fields: ['id', 'version', 'target_collection', 'target_item'], filter }, (event, data) =>
      onThreads(event === 'init' && inits++ > 0 ? 'reconnect' : event, data))
  }, 50)
}

/**
 * `init` is the subscription's first snapshot: only versions that moved since our fetch count. `reconnect` is a later
 * snapshot after a drop or sleep: anything may have changed while we weren't listening, so everything refetches.
 */
function onThreads(event: string, data: Record<string, unknown>[] | string[]) {
  if (event === 'delete') return
  const changed: string[] = []
  for (const row of data as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object' || !row.target_collection) continue
    const key = targetKey(String(row.target_collection), String(row.target_item))
    if (!refs.has(key)) continue
    // Any difference counts: concurrent writers can store the same or even a lower number. A target we haven't
    // loaded yet is about to be fetched anyway.
    if (versions.has(key) && versions.get(key) !== Number(row.version)) changed.push(key)
    else if (!versions.has(key) && event !== 'init') changed.push(key)
  }
  const keys = event === 'reconnect' ? [...refs.keys()] : changed
  const toFetch: string[] = []
  for (const key of keys) {
    const open = listeners.get(key)
    if (open?.size) open.forEach((fn) => fn())
    else toFetch.push(key)
  }
  if (toFetch.length) schedule(toFetch)
}

/**
 * The live summary for a target (undefined until loaded). Registers the target while the calling scope lives.
 * `item` may be a ref or getter, so a list can re-point a component.
 */
export function useSocialSummary(collection: MaybeRefOrGetter<string>, item: MaybeRefOrGetter<string | number>) {
  const key = computed(() => targetKey(toValue(collection), String(toValue(item))))
  if (import.meta.client) {
    const { loggedIn } = useUserSession()
    const add = (k: string) => {
      refs.set(k, (refs.get(k) ?? 0) + 1)
      if (refs.get(k) === 1) resubscribe()
      if (!summaries.has(k)) schedule([k])
    }
    const drop = (k: string) => {
      const n = (refs.get(k) ?? 1) - 1
      if (n > 0) return void refs.set(k, n)
      refs.delete(k)
      resubscribe()
    }
    watch([key, loggedIn], ([k, ok], old) => {
      if (old?.[0] && old[1]) drop(old[0])
      if (ok) add(k)
    }, { immediate: true })
    onScopeDispose(() => loggedIn.value && drop(key.value))
  }
  return computed(() => summaries.get(key.value))
}

export function useSocialTargets() {
  return {
    viewer: readonly(viewer),
    setSummary,
    setViewer: (v: SocialViewer) => (viewer.value = v),
    get: (key: string) => summaries.get(key),
    /** Refetch these targets' summaries. */
    refresh: (keys: string[]) => schedule(keys),
    /** An open thread takes over version bumps for its target (it fetches a delta, which includes the summary). */
    onThreadChange(key: string, fn: Listener) {
      const set = listeners.get(key) ?? new Set()
      set.add(fn)
      listeners.set(key, set)
      return () => {
        set.delete(fn)
        if (!set.size) listeners.delete(key)
      }
    },
  }
}
