import type { ConnectionAction, ConnectionResult, ConnectionState, NetworkOverview, NetworkPerson } from '../../shared/types/network'

// The signed-in member's network, app-wide: connections (ranked), requests in and out, blocks, and every action on
// them. One realtime subscription to the member's own `connections` rows (their policy decides which: a quiet decline
// never reaches its sender, a block never reaches the blocked) refetches the overview on any change, so requests and
// acceptances appear live on both sides; useSocialRealtime refetches after a reconnect or the device waking.

const overview = ref<NetworkOverview | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** States set by an action in flight (optimistic), until the next overview arrives. */
const optimistic = ref<Record<string, ConnectionState>>({})
const busy = ref<Record<string, boolean>>({})
let started = false
let unsubscribe: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let generation = 0

async function load() {
  const mine = ++generation
  loading.value = !overview.value
  try {
    const next = await $fetch<NetworkOverview>('/api/connections')
    if (mine !== generation) return
    overview.value = next
    optimistic.value = {}
    error.value = null
  } catch (err) {
    if (mine === generation) error.value = socialError(err)
  } finally {
    if (mine === generation) loading.value = false
  }
}

function refreshSoon(delay = 250) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void load(), delay)
}

function start() {
  if (started || import.meta.server) return
  started = true
  const { loggedIn } = useUserSession()
  effectScope(true).run(() => watch(loggedIn, (ok) => {
    unsubscribe?.()
    unsubscribe = null
    if (!ok) {
      overview.value = null
      optimistic.value = {}
      return
    }
    void load()
    let inits = 0
    unsubscribe = useSocialRealtime().subscribe(
      'connections',
      { fields: ['id', 'status', 'requester', 'addressee', 'date_updated'], limit: 1 },
      (event) => {
        if (event === 'init' && inits++ === 0) return // the first snapshot: load() just ran
        refreshSoon()
      },
    )
  }, { immediate: true }))
}

function stateOf(id: string | null | undefined): ConnectionState {
  if (!id) return 'none'
  const o = optimistic.value[id]
  if (o) return o
  const v = overview.value
  if (!v) return 'none'
  if (v.connections.some((c) => c.person.id === id)) return 'connected'
  if (v.incoming.some((r) => r.person.id === id)) return 'incoming'
  if (v.outgoing.some((r) => r.person.id === id)) return 'outgoing'
  if (v.blocked.some((r) => r.person.id === id)) return 'blocked'
  return 'none'
}

async function act(user: string, guess: ConnectionState, call: () => Promise<ConnectionResult>): Promise<ConnectionState> {
  busy.value = { ...busy.value, [user]: true }
  const before = optimistic.value[user]
  optimistic.value = { ...optimistic.value, [user]: guess }
  try {
    const result = await call()
    optimistic.value = { ...optimistic.value, [user]: result.state }
    refreshSoon(0)
    return result.state
  } catch (err) {
    const { [user]: _dropped, ...rest } = optimistic.value
    optimistic.value = before ? { ...rest, [user]: before } : rest
    throw new Error(socialError(err), { cause: err })
  } finally {
    const { [user]: _, ...others } = busy.value
    busy.value = others
  }
}

const request = (user: string) => act(user, stateOf(user) === 'incoming' ? 'connected' : 'outgoing', () => $fetch<ConnectionResult>('/api/connections', { method: 'POST', body: { user } }))

function respond(user: string, action: ConnectionAction) {
  const guess: Record<ConnectionAction, ConnectionState> = { accept: 'connected', decline: 'none', cancel: 'none', remove: 'none' }
  return act(user, guess[action], () => $fetch<ConnectionResult>(`/api/connections/${user}`, { method: 'PATCH', body: { action } }))
}

const setBlocked = (user: string, blocked: boolean) =>
  act(user, blocked ? 'blocked' : 'none', () => $fetch<ConnectionResult>('/api/connections/blocks', { method: 'PUT', body: { user, blocked } }))

async function introduce(a: string, b: string, note: string) {
  try {
    return await $fetch<{ ok: boolean, already: boolean }>('/api/connections/intro', { method: 'POST', body: { a, b, note } })
  } catch (err) {
    throw new Error(socialError(err), { cause: err })
  }
}

/** Find someone in the overview by id. */
function personOf(id: string): NetworkPerson | null {
  const v = overview.value
  if (!v) return null
  return v.connections.find((c) => c.person.id === id)?.person
    ?? [...v.incoming, ...v.outgoing, ...v.blocked].find((r) => r.person.id === id)?.person
    ?? null
}

export function useConnections() {
  start()
  return {
    overview: readonly(overview),
    loading: readonly(loading),
    error: readonly(error),
    busy: readonly(busy),
    stateOf,
    personOf,
    request,
    accept: (user: string) => respond(user, 'accept'),
    decline: (user: string) => respond(user, 'decline'),
    cancel: (user: string) => respond(user, 'cancel'),
    remove: (user: string) => respond(user, 'remove'),
    block: (user: string) => setBlocked(user, true),
    unblock: (user: string) => setBlocked(user, false),
    introduce,
    refresh: load,
  }
}
