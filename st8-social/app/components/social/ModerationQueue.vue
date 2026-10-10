<script setup lang="ts">
// The moderation queue (Phase 8), for this app's moderators and admins: Needs review (targets with pending reports,
// automatically hidden ones first), Reviewed, Suspended members and the Log. On desktop a list beside the selected
// target; on phones the list, then the target full width. `?tab=` picks the tab and `?target=<collection>:<item>` opens
// one target (moderators' notifications and emails link there).
import type { ModerationLogPage, QueueItem, QueuePage, SuspendedMember } from '../../../shared/types/social'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'

const route = useRoute()
const router = useRouter()
const now = useSocialClock()
const moderation = useSocialModeration()
const reasons = Object.fromEntries(REPORT_REASONS.map((r) => [r.key, r.label]))

type Tab = 'pending' | 'reviewed' | 'suspended' | 'log'
const TABS: { key: Tab, label: string, icon: string }[] = [
  { key: 'pending', label: 'Needs review', icon: 'lucide:flag' },
  { key: 'reviewed', label: 'Reviewed', icon: 'lucide:check-check' },
  { key: 'suspended', label: 'Suspended', icon: 'lucide:user-x' },
  { key: 'log', label: 'Log', icon: 'lucide:scroll-text' },
]
const tab = computed<Tab>({
  get: () => (TABS.some((t) => t.key === route.query.tab) ? (route.query.tab as Tab) : 'pending'),
  set: (value) => void router.replace({ query: { ...route.query, tab: value === 'pending' ? undefined : value, target: undefined } }),
})
const target = computed(() => (typeof route.query.target === 'string' ? route.query.target : null))
const select = (key: string | null) => void router.replace({ query: { ...route.query, target: key ?? undefined } })

// ── Queue (pending / reviewed) ─────────────────────────────────────────────────────────────────────────────────
const items = ref<QueueItem[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const loaded = ref(false)
// The opened target when it isn't in the list (a notification link to something already reviewed).
const extra = ref<QueueItem | null>(null)
const selected = computed(() => items.value.find((i) => i.key === target.value) ?? (extra.value?.key === target.value ? extra.value : null))

async function loadQueue(more = false) {
  if (tab.value !== 'pending' && tab.value !== 'reviewed') return
  loading.value = true
  error.value = null
  try {
    const page = await $fetch<QueuePage>('/api/social/moderation/queue', { query: { tab: tab.value, before: more ? next.value ?? undefined : undefined } })
    items.value = more ? [...items.value, ...page.items.filter((i) => !items.value.some((j) => j.key === i.key))] : page.items
    next.value = page.next
    loaded.value = true
  } catch (err) {
    error.value = socialError(err, 'The queue didn’t load. Please try again.')
  } finally {
    loading.value = false
  }
}

async function loadTarget(key: string) {
  if (items.value.some((i) => i.key === key)) return
  const page = await $fetch<QueuePage>('/api/social/moderation/queue', { query: { target: key } }).catch(() => null)
  extra.value = page?.items[0] ?? null
}

function updated(item: QueueItem | null, key: string) {
  void moderation.refresh()
  if (tab.value === 'pending' && (!item || !item.pending)) {
    // Reviewed: it leaves the list; open the next one.
    const at = items.value.findIndex((i) => i.key === key)
    items.value = items.value.filter((i) => i.key !== key)
    if (extra.value?.key === key) extra.value = item
    const following = items.value[Math.min(at, items.value.length - 1)]
    select(isDesktop.value ? (following?.key ?? null) : null)
    return
  }
  if (item) {
    items.value = items.value.map((i) => (i.key === key ? item : i))
    if (extra.value?.key === key) extra.value = item
  }
}

// ── Suspended ──────────────────────────────────────────────────────────────────────────────────────────────────
const suspended = ref<SuspendedMember[] | null>(null)
const restoring = ref<string | null>(null)
async function loadSuspended() {
  loading.value = true
  error.value = null
  try {
    suspended.value = (await $fetch<{ items: SuspendedMember[] }>('/api/social/moderation/suspended')).items
  } catch (err) {
    error.value = socialError(err, 'The list didn’t load. Please try again.')
  } finally {
    loading.value = false
  }
}
async function restore(member: SuspendedMember, restoreContent: boolean) {
  restoring.value = member.person.id
  try {
    const res = await $fetch<{ restored: number }>('/api/social/moderation/unsuspend', { method: 'POST', body: { user: member.person.id, restoreContent } })
    toast.success(`${member.person.name} is restored.${res.restored ? ` ${res.restored} item${res.restored === 1 ? '' : 's'} back.` : ''}`)
    suspended.value = (suspended.value ?? []).filter((m) => m.person.id !== member.person.id)
  } catch (err) {
    toast.error(socialError(err, 'That didn’t work. Please try again.'))
  } finally {
    restoring.value = null
  }
}
const until = (value: string | null) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'until restored')

// ── Log ────────────────────────────────────────────────────────────────────────────────────────────────────────
const log = ref<ModerationLogPage | null>(null)
async function loadLog(more = false) {
  loading.value = true
  error.value = null
  try {
    const page = await $fetch<ModerationLogPage>('/api/social/moderation/log', { query: { before: more ? log.value?.next ?? undefined : undefined } })
    log.value = more && log.value ? { items: [...log.value.items, ...page.items], next: page.next } : page
  } catch (err) {
    error.value = socialError(err, 'The log didn’t load. Please try again.')
  } finally {
    loading.value = false
  }
}

const isDesktop = useSocialDesktop()
function load() {
  if (tab.value === 'suspended') return loadSuspended()
  if (tab.value === 'log') return loadLog()
  return loadQueue()
}
watch(tab, () => {
  items.value = []
  loaded.value = false
  void load()
})
onMounted(async () => {
  await load()
  if (target.value) await loadTarget(target.value)
  else if (isDesktop.value && items.value[0]) select(items.value[0].key)
})
watch(target, (key) => key && void loadTarget(key))
useEventListener(document, 'visibilitychange', () => document.visibilityState === 'visible' && tab.value === 'pending' && void loadQueue())
// A new report arriving (the bell's count moves): refresh the list.
watch(() => moderation.pending.value, () => tab.value === 'pending' && void loadQueue())

const STATE_BADGE: Record<string, string> = { hidden: 'Hidden', removed: 'Removed', deleted: 'Deleted', gone: 'Gone' }
const snippet = (i: QueueItem) => i.preview?.title || i.preview?.text || (i.label === 'profile' ? i.owner?.name : null) || `A ${i.label}`
const topReason = (i: QueueItem) => {
  const counts = new Map<string, number>()
  for (const r of i.reports) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1)
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  return key ? (reasons[key] ?? key) : null
}
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <div class="flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-muted p-1 no-scrollbar" role="tablist" aria-label="Moderation view">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        :class="cn('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors', tab === t.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')"
        @click="tab = t.key"
      >
        <Icon :name="t.icon" class="size-3.5" />
        {{ t.label }}
        <span v-if="t.key === 'pending' && moderation.pending.value" class="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] text-white">{{ moderation.pending.value }}</span>
      </button>
    </div>

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <!-- Needs review / Reviewed -->
    <div v-if="tab === 'pending' || tab === 'reviewed'" class="grid w-full gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div :class="cn('flex min-w-0 flex-col gap-2', selected && 'hidden md:flex')">
        <template v-if="loading && !loaded">
          <Skeleton v-for="n in 4" :key="n" class="h-20 w-full rounded-2xl" />
        </template>
        <div v-else-if="!items.length && loaded" class="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-glass-border px-4 py-10 text-center">
          <Icon :name="tab === 'pending' ? 'lucide:shield-check' : 'lucide:inbox'" class="size-6 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">{{ tab === 'pending' ? 'Nothing needs review. Reports will show up here.' : 'Nothing reviewed yet.' }}</p>
        </div>
        <ul v-else class="flex flex-col gap-2">
          <li v-for="i in items" :key="i.key">
            <button
              type="button"
              :aria-current="i.key === target ? 'true' : undefined"
              :class="cn('glass flex w-full flex-col gap-1 rounded-2xl border border-glass-border px-4 py-3 text-left transition-colors hover:bg-muted/60', i.key === target && 'ring-2 ring-primary')"
              @click="select(i.key)"
            >
              <span class="flex items-center gap-2">
                <span class="eyebrow text-[10px]">{{ i.label }}</span>
                <span v-if="i.autoHidden" class="rounded-full bg-amber-500/15 px-1.5 text-[9px] font-bold tracking-wider text-amber-700 uppercase dark:text-amber-300">Hidden after reports</span>
                <span v-else-if="STATE_BADGE[i.state]" class="rounded-full bg-muted px-1.5 text-[9px] font-bold tracking-wider text-muted-foreground uppercase">{{ STATE_BADGE[i.state] }}</span>
                <span class="ml-auto text-[11px] text-muted-foreground">{{ socialAgo(tab === 'reviewed' ? (i.review?.at ?? i.lastAt) : i.lastAt, now) }}</span>
              </span>
              <span class="line-clamp-2 text-sm font-bold break-words">{{ snippet(i) }}</span>
              <span class="text-xs text-muted-foreground">
                <template v-if="i.owner">{{ i.owner.name }} · </template>
                <template v-if="tab === 'pending'">{{ i.pending }} report{{ i.pending === 1 ? '' : 's' }}<template v-if="topReason(i)"> · {{ topReason(i) }}</template></template>
                <template v-else>{{ i.review?.status === 'dismissed' ? 'Left up' : (i.review?.action ?? 'Actioned').replace(/_/g, ' ') }}</template>
              </span>
            </button>
          </li>
        </ul>
        <Button v-if="tab === 'reviewed' && next" variant="outline" size="sm" class="rounded-full" :disabled="loading" @click="loadQueue(true)">Load more</Button>
      </div>

      <div :class="cn('min-w-0', !selected && 'hidden md:block')">
        <div v-if="selected" class="glass rounded-3xl border border-glass-border p-5 md:sticky md:top-20 md:p-6">
          <SocialModerationItem :key="selected.key" :item="selected" @updated="(it) => updated(it, selected!.key)" @back="select(null)" />
        </div>
        <div v-else-if="items.length" class="hidden h-full min-h-48 items-center justify-center rounded-3xl border border-dashed border-glass-border text-sm text-muted-foreground md:flex">
          Pick a report to review it.
        </div>
      </div>
    </div>

    <!-- Suspended -->
    <div v-else-if="tab === 'suspended'" class="flex w-full max-w-2xl flex-col gap-3">
      <template v-if="loading && !suspended">
        <Skeleton v-for="n in 3" :key="n" class="h-20 w-full rounded-2xl" />
      </template>
      <p v-else-if="suspended && !suspended.length" class="rounded-2xl border border-dashed border-glass-border px-4 py-10 text-center text-sm text-muted-foreground">Nobody is suspended.</p>
      <ul v-else class="flex flex-col gap-3">
        <li v-for="m in suspended ?? []" :key="m.person.id" class="glass flex flex-col gap-3 rounded-2xl border border-glass-border p-4 sm:flex-row sm:items-center">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <SocialAvatar :person="m.person" size="md" />
            <div class="min-w-0">
              <p class="truncate font-bold">{{ m.person.name }} <span v-if="m.role !== 'member'" class="text-xs font-normal text-muted-foreground">· {{ m.role }}</span></p>
              <p class="text-xs text-muted-foreground">
                Suspended {{ m.until ? `until ${until(m.until)}` : 'until restored' }}<template v-if="m.by"> by {{ m.by.name }}</template><template v-if="m.since"> · {{ socialAgo(m.since, now) }}</template>
              </p>
              <p v-if="m.reason" class="mt-1 text-sm break-words">{{ m.reason }}</p>
              <p v-if="m.hidden" class="mt-1 text-xs text-muted-foreground">{{ m.hidden }} {{ m.hidden === 1 ? 'post or comment' : 'posts and comments' }} hidden with it.</p>
            </div>
          </div>
          <div v-if="m.canRestore" class="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" class="rounded-full text-xs font-bold tracking-wider uppercase" :disabled="restoring === m.person.id" @click="restore(m, true)">
              <Icon v-if="restoring === m.person.id" name="lucide:loader-circle" class="animate-spin" /> Restore{{ m.hidden ? ' with content' : '' }}
            </Button>
            <Button v-if="m.hidden" size="sm" variant="outline" class="rounded-full text-xs font-bold tracking-wider uppercase" :disabled="restoring === m.person.id" @click="restore(m, false)">Restore only them</Button>
          </div>
          <p v-else class="text-xs text-muted-foreground">An admin can restore them.</p>
        </li>
      </ul>
    </div>

    <!-- Log -->
    <div v-else class="flex w-full max-w-2xl flex-col gap-2">
      <template v-if="loading && !log">
        <Skeleton v-for="n in 5" :key="n" class="h-12 w-full rounded-xl" />
      </template>
      <p v-else-if="log && !log.items.length" class="rounded-2xl border border-dashed border-glass-border px-4 py-10 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
      <ol v-else class="flex flex-col divide-y divide-glass-border">
        <li v-for="e in log?.items ?? []" :key="e.id" class="flex items-start gap-3 py-3">
          <SocialAvatar :person="e.moderator" size="sm" />
          <div class="min-w-0 flex-1 text-sm">
            <p>
              <span class="font-bold">{{ e.moderator?.name ?? 'Automatic' }}</span>
              {{ LOG_ACTION_LABELS[e.action] ?? e.action }}
              <template v-if="e.action.endsWith('suspend_user')">{{ e.author?.name ?? 'a member' }}</template>
              <template v-else>
                <NuxtLink v-if="e.target.link" :to="e.target.link" class="font-bold hover:underline">{{ e.author ? `${e.author.name}’s ${e.target.label}` : `a ${e.target.label}` }}</NuxtLink>
                <template v-else>{{ e.author ? `${e.author.name}’s ${e.target.label}` : `a ${e.target.label}` }}</template>
              </template>
            </p>
            <p v-if="e.reason" class="text-xs break-words text-muted-foreground">{{ e.reason }}</p>
          </div>
          <span class="shrink-0 text-[11px] text-muted-foreground" :title="socialDateTime(e.createdAt)">{{ socialAgo(e.createdAt, now) }}</span>
        </li>
      </ol>
      <Button v-if="log?.next" variant="outline" size="sm" class="self-center rounded-full" :disabled="loading" @click="loadLog(true)">Load more</Button>
    </div>
  </div>
</template>
