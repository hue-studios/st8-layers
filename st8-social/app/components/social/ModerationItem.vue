<script setup lang="ts">
// One reported target in the moderation queue: what was reported (as it was then), its state now, who owns it, every
// report with the reporter's record, and the actions this moderator may take. Remove, clear, refer and hide ask for an
// optional reason first (kept in the log; the person moderated never sees it or who acted).
import type { QueueAction, QueueItem } from '../../../shared/types/social'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'

const props = defineProps<{ item: QueueItem }>()
const emit = defineEmits<{ updated: [item: QueueItem | null], back: [] }>()
const now = useSocialClock()
const profileLink = useSocialProfileLink()
const reasons = Object.fromEntries(REPORT_REASONS.map((r) => [r.key, r.label]))

const STATE: Record<QueueItem['state'], string | null> = {
  published: null,
  live: null,
  hidden: 'Hidden',
  removed: 'Removed',
  deleted: 'Deleted by its author',
  gone: 'No longer exists',
}
const stateText = computed(() => (props.item.autoHidden ? 'Hidden after reports' : STATE[props.item.state]))

/** Ask for a reason first. */
const CONFIRM: Partial<Record<QueueAction, { title: string, description: string, destructive?: boolean }>> = {
  hide: { title: 'Hide it?', description: 'Only its author and moderators will see it. The author is told a moderator hid it, never who.' },
  remove: { title: 'Remove it?', description: 'Its content is deleted for good. The author is told a moderator removed it, never who.', destructive: true },
  clear: { title: 'Clear this profile’s content?', description: 'Their headline, bio, skills, links and photo are removed; their name, title and organization stay. They’re told a moderator did it, never who.', destructive: true },
  refer: { title: 'Refer to the admins?', description: 'This app can’t change it. The reports close here, and the admins are told to fix it at the source.' },
}
const actions = computed(() => props.item.actions.filter((a) => a !== 'suspend'))
const labelOf = (a: QueueAction) => (a === 'hide' && props.item.state === 'hidden' ? 'Keep hidden' : a === 'dismiss' && props.item.state === 'hidden' ? 'Restore it' : QUEUE_ACTION_LABELS[a])

const busy = ref<QueueAction | null>(null)
const confirmFor = ref<QueueAction | null>(null)
const confirmOpen = computed({ get: () => !!confirmFor.value, set: (v) => !v && (confirmFor.value = null) })
const reason = ref('')
const suspendOpen = ref(false)

function start(action: QueueAction) {
  if (action === 'suspend') return void (suspendOpen.value = true)
  if (CONFIRM[action] && !(action === 'hide' && props.item.state === 'hidden')) {
    reason.value = ''
    confirmFor.value = action
    return
  }
  void act(action)
}

async function act(action: QueueAction) {
  busy.value = action
  try {
    const res = await $fetch<{ item: QueueItem | null }>('/api/social/moderation/resolve', {
      method: 'POST',
      body: { collection: props.item.collection, item: props.item.item, action, reason: reason.value.trim() || undefined },
    })
    confirmFor.value = null
    toast.success({ dismiss: 'Done. The reporters are told it was reviewed.', hide: 'Hidden.', unhide: 'Restored.', remove: 'Removed.', lock: 'Comments closed.', unlock: 'Comments reopened.', clear: 'Profile content cleared.', refer: 'Referred to the admins.', suspend: '' }[action])
    emit('updated', res.item)
  } catch (err) {
    toast.error(socialError(err, 'That didn’t work. Please try again.'))
  } finally {
    busy.value = null
  }
}

async function suspended() {
  const res = await $fetch<{ items: QueueItem[] }>('/api/social/moderation/queue', { query: { target: props.item.key } }).catch(() => null)
  emit('updated', res?.items[0] ?? null)
}
</script>

<template>
  <article class="flex flex-col gap-5">
    <header class="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="icon-sm" class="rounded-full md:hidden" aria-label="Back to the list" @click="emit('back')">
        <Icon name="lucide:arrow-left" class="size-4" />
      </Button>
      <p class="eyebrow text-[10px]">Reported {{ item.label }}</p>
      <span v-if="stateText" :class="cn('rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase', item.state === 'hidden' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground')">{{ stateText }}</span>
      <span v-if="item.locked" class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Comments closed</span>
      <NuxtLink v-if="item.link && item.state !== 'gone'" :to="item.link" class="ml-auto flex items-center gap-1 text-xs font-bold text-primary hover:underline">
        Open <Icon name="lucide:arrow-up-right" class="size-3.5" />
      </NuxtLink>
    </header>

    <div v-if="item.owner" class="flex items-center gap-3">
      <SocialAvatar :person="item.owner" size="md" />
      <div class="min-w-0">
        <NuxtLink v-if="profileLink(item.owner.id) && item.ownerMembership?.status === 'active'" :to="profileLink(item.owner.id)!" class="truncate font-bold hover:underline">{{ item.owner.name }}</NuxtLink>
        <p v-else class="truncate font-bold">{{ item.owner.name }}</p>
        <p class="text-xs text-muted-foreground">
          <template v-if="item.ownerMembership?.status === 'suspended'">Suspended here</template>
          <template v-else-if="item.ownerMembership && item.ownerMembership.role !== 'member'">{{ item.ownerMembership.role }}</template>
          <template v-else-if="!item.ownerMembership">Not a member here</template>
          <template v-else>Member</template>
        </p>
      </div>
    </div>

    <section v-if="item.preview" class="glass flex flex-col gap-2 rounded-2xl border border-glass-border p-4" aria-label="As it was reported">
      <p class="eyebrow text-[10px]">As it was reported</p>
      <p v-if="item.preview.title" class="font-bold">{{ item.preview.title }}</p>
      <p v-if="item.preview.text" class="text-sm whitespace-pre-line break-words">{{ item.preview.text }}</p>
      <ul v-if="item.preview.meta.length" class="flex flex-wrap gap-1.5">
        <li v-for="m in item.preview.meta" :key="m" class="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{{ m }}</li>
      </ul>
    </section>

    <p v-if="item.blocked" class="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground" role="note">
      <Icon name="lucide:info" class="mr-1 inline size-4 align-text-bottom" /> {{ item.blocked }}
    </p>
    <div v-else-if="item.actions.length" class="flex flex-wrap gap-2">
      <Button
        v-for="a in actions"
        :key="a"
        size="sm"
        :variant="a === 'remove' || a === 'clear' ? 'destructive' : a === 'dismiss' ? 'default' : 'outline'"
        class="rounded-full text-xs font-bold tracking-wider uppercase"
        :disabled="!!busy"
        @click="start(a)"
      >
        <Icon v-if="busy === a" name="lucide:loader-circle" class="animate-spin" /> {{ labelOf(a) }}
      </Button>
      <Button v-if="item.actions.includes('suspend') && item.owner" size="sm" variant="outline" class="rounded-full text-xs font-bold tracking-wider text-destructive uppercase" :disabled="!!busy" @click="start('suspend')">
        <Icon name="lucide:user-x" /> Suspend {{ item.owner.first_name || item.owner.name }}
      </Button>
    </div>

    <p v-if="item.review" class="text-xs text-muted-foreground">
      Reviewed by {{ item.review.by?.name ?? 'a moderator' }}<template v-if="item.review.at"> ({{ socialAgo(item.review.at, now) }})</template>:
      {{ item.review.status === 'dismissed' ? 'left up' : (item.review.action ?? 'actioned').replace(/_/g, ' ') }}.
    </p>

    <section class="flex flex-col gap-3" :aria-label="`${item.reports.length} report${item.reports.length === 1 ? '' : 's'}`">
      <p class="eyebrow text-[10px]">{{ item.reports.length }} report{{ item.reports.length === 1 ? '' : 's' }}<template v-if="item.pending && item.pending !== item.reports.length"> · {{ item.pending }} pending</template></p>
      <p v-if="!item.reports.length" class="text-sm text-muted-foreground">No reports on this.</p>
      <ul class="flex flex-col gap-3">
        <li v-for="r in item.reports" :key="r.id" class="flex gap-3">
          <SocialAvatar :person="r.reporter" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="text-sm">
              <span class="font-bold">{{ r.reporter?.name ?? 'A former member' }}</span>
              · {{ reasons[r.reason] ?? r.reason }}
              <span class="text-xs text-muted-foreground">· {{ socialAgo(r.createdAt, now) }}</span>
              <span v-if="r.status !== 'pending'" class="text-xs text-muted-foreground"> · {{ r.status }}</span>
            </p>
            <p v-if="r.details" class="mt-0.5 text-sm whitespace-pre-line break-words text-muted-foreground">“{{ r.details }}”</p>
            <p class="mt-1 text-[11px] text-muted-foreground">
              {{ r.history.filed }} report{{ r.history.filed === 1 ? '' : 's' }} lately · {{ r.history.actioned }} acted on · {{ r.history.dismissed }} left up
              <span v-if="!r.counts" class="ml-1 rounded-full bg-muted px-1.5 py-0.5 font-bold">{{ r.why }}: doesn’t count toward hiding</span>
            </p>
          </div>
        </li>
      </ul>
    </section>

    <ResponsiveDialog v-model:open="confirmOpen" :title="confirmFor ? CONFIRM[confirmFor]!.title : ''" :description="confirmFor ? CONFIRM[confirmFor]!.description : ''">
      <div class="flex flex-col gap-1.5">
        <Label for="moderation-reason" class="eyebrow text-[10px]">Note for the log (optional)</Label>
        <Textarea id="moderation-reason" v-model="reason" rows="2" maxlength="500" class="rounded-xl text-sm" />
      </div>
      <template #footer>
        <Button variant="ghost" class="rounded-full" @click="confirmFor = null">Cancel</Button>
        <Button :variant="confirmFor && CONFIRM[confirmFor]!.destructive ? 'destructive' : 'default'" class="rounded-full font-bold tracking-wider uppercase" :disabled="!!busy" @click="confirmFor && act(confirmFor)">
          <Icon v-if="busy" name="lucide:loader-circle" class="animate-spin" /> {{ confirmFor ? labelOf(confirmFor) : '' }}
        </Button>
      </template>
    </ResponsiveDialog>
    <SocialSuspendDialog v-if="item.owner" v-model:open="suspendOpen" :person="{ id: item.owner.id, name: item.owner.name }" :from="{ collection: item.collection, item: item.item }" @done="suspended" />
  </article>
</template>
