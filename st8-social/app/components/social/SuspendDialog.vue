<script setup lang="ts">
// Suspend a member of this app (moderators): for a week, a month, until a date or until restored, with a reason only
// moderators see, and optionally hiding everything they've posted here. They're signed out of this app within about
// 30 seconds; other ST8 apps and their account aren't touched. `from` is the reported item this answers (its reports
// close). A dialog on desktop, a drawer on phones; method="post", submit disabled until hydrated.
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Textarea } from '~/components/ui/textarea'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ person: { id: string, name: string }, from?: { collection: string, item: string } | null }>()
const emit = defineEmits<{ done: [] }>()

type Length = 'week' | 'month' | 'date' | 'open'
const LENGTHS: { key: Length, label: string }[] = [
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'date', label: 'Until a date' },
  { key: 'open', label: 'Until restored' },
]
const length = ref<Length>('week')
const date = ref('')
const reason = ref('')
const hide = ref(false)
const sending = ref(false)
const error = ref<string | null>(null)
const hydrated = ref(false)
onMounted(() => (hydrated.value = true))
const formId = useId()

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const minDate = computed(() => ymd(new Date(Date.now() + 86_400_000)))
const until = computed<string | null>(() => {
  if (length.value === 'week') return new Date(Date.now() + 7 * 86_400_000).toISOString()
  if (length.value === 'month') return new Date(Date.now() + 30 * 86_400_000).toISOString()
  if (length.value === 'date') return date.value ? new Date(`${date.value}T23:59:00`).toISOString() : null
  return null
})
const ready = computed(() => !!reason.value.trim() && (length.value !== 'date' || !!date.value))

watch(open, (value) => {
  if (!value) return
  length.value = 'week'
  date.value = ''
  reason.value = ''
  hide.value = false
  error.value = null
})

async function submit() {
  if (!ready.value || sending.value) return
  sending.value = true
  error.value = null
  try {
    const res = await $fetch<{ hidden: number }>('/api/social/moderation/suspend', {
      method: 'POST',
      body: { user: props.person.id, until: until.value, reason: reason.value.trim(), hideContent: hide.value, from: props.from ?? undefined },
    })
    open.value = false
    toast.success(`${props.person.name} is suspended here.${res.hidden ? ` ${res.hidden} post${res.hidden === 1 ? '' : 's'} and comments hidden.` : ''}`)
    emit('done')
  } catch (err) {
    error.value = socialError(err, 'The suspension didn’t go through. Please try again.')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" :title="`Suspend ${person.name}?`" description="They’re signed out of this app within about 30 seconds and can’t sign back in until it ends. Other ST8 apps and their account aren’t affected. They’re never told who suspended them.">
    <form :id="formId" method="post" class="flex flex-col gap-4" @submit.prevent="submit">
      <fieldset class="flex flex-col gap-1.5">
        <legend class="eyebrow mb-1.5 text-[10px]">How long</legend>
        <RadioGroup v-model="length" name="length" class="grid grid-cols-2 gap-1">
          <Label
            v-for="l in LENGTHS"
            :key="l.key"
            :for="`${formId}-${l.key}`"
            :class="cn('flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted', length === l.key && 'bg-muted font-bold')"
          >
            <RadioGroupItem :id="`${formId}-${l.key}`" :value="l.key" />
            {{ l.label }}
          </Label>
        </RadioGroup>
        <Input v-if="length === 'date'" v-model="date" type="date" name="until" :min="minDate" class="mt-1 rounded-xl" aria-label="Last day of the suspension" />
      </fieldset>
      <div class="flex flex-col gap-1.5">
        <Label :for="`${formId}-reason`" class="eyebrow text-[10px]">Reason (moderators only)</Label>
        <Textarea :id="`${formId}-reason`" v-model="reason" name="reason" rows="3" maxlength="500" class="rounded-xl text-sm" placeholder="What happened, for the log" />
      </div>
      <Label :for="`${formId}-hide`" class="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 hover:bg-muted">
        <Checkbox :id="`${formId}-hide`" v-model="hide" class="mt-0.5" />
        <span class="flex flex-col gap-0.5">
          <span class="text-sm font-bold">Also hide what they’ve posted here</span>
          <span class="text-xs font-normal text-muted-foreground">Their posts and comments in this app. Restoring them can bring it back.</span>
        </span>
      </Label>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <Button variant="ghost" class="rounded-full" @click="open = false">Cancel</Button>
      <Button type="submit" :form="formId" variant="destructive" :disabled="!hydrated || !ready || sending" class="rounded-full font-bold tracking-wider uppercase">
        <Icon v-if="sending" name="lucide:loader-circle" class="animate-spin" /> Suspend
      </Button>
    </template>
  </ResponsiveDialog>
</template>
