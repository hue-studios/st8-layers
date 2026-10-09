<script setup lang="ts">
// Report something: a reason and optional details. One report per member per target; the author only hears about it
// if a moderator acts. A dialog on desktop, a drawer on phones. The form is method="post" with its submit disabled
// until hydrated.
import type { ReportReason } from '../../../shared/types/social'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Textarea } from '~/components/ui/textarea'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ collection: string, item: string, label?: string }>(), { label: 'post' })

const reasons = REPORT_REASONS
const maxDetails = REPORT_DETAILS_MAX
const reason = ref<ReportReason | ''>('')
const details = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
const hydrated = ref(false)
onMounted(() => (hydrated.value = true))
const formId = useId()
const needsDetails = computed(() => reason.value === 'other' && !details.value.trim())

async function submit() {
  if (!reason.value || needsDetails.value || sending.value) return
  sending.value = true
  error.value = null
  try {
    await $fetch('/api/social/reports', { method: 'POST', body: { collection: props.collection, item: props.item, reason: reason.value, details: details.value.trim() || undefined } })
    open.value = false
    toast.success('Thanks. A moderator will take a look.')
  } catch (err) {
    error.value = socialError(err, 'Your report wasn’t sent. Please try again.')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" :title="`Report ${label}`" :description="`Why are you reporting this ${label}? Moderators review every report.`">
    <form :id="formId" method="post" class="flex flex-col gap-4" @submit.prevent="submit">
      <RadioGroup v-model="reason" name="reason" class="gap-1" :aria-label="`Reason for reporting this ${label}`">
        <Label
          v-for="r in reasons"
          :key="r.key"
          :for="`${formId}-${r.key}`"
          :class="cn('flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 hover:bg-muted', reason === r.key && 'bg-muted')"
        >
          <RadioGroupItem :id="`${formId}-${r.key}`" :value="r.key" class="mt-0.5" />
          <span class="flex flex-col gap-0.5">
            <span class="text-sm font-bold">{{ r.label }}</span>
            <span class="text-xs font-normal text-muted-foreground">{{ r.hint }}</span>
          </span>
        </Label>
      </RadioGroup>
      <div class="flex flex-col gap-1.5">
        <Label :for="`${formId}-details`" class="eyebrow text-[10px]">Details {{ reason === 'other' ? '' : '(optional)' }}</Label>
        <Textarea :id="`${formId}-details`" v-model="details" name="details" rows="3" :maxlength="maxDetails" class="rounded-xl text-sm" />
      </div>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <Button variant="ghost" class="rounded-full" @click="open = false">Cancel</Button>
      <Button type="submit" :form="formId" :disabled="!hydrated || !reason || needsDetails || sending" class="rounded-full font-bold tracking-wider uppercase">
        <Icon v-if="sending" name="lucide:loader-circle" class="animate-spin" /> Send report
      </Button>
    </template>
  </ResponsiveDialog>
</template>
