<script setup lang="ts">
// Write a comment, a reply or an edit. The textarea grows with its text; `@` opens member autocomplete
// (SocialMentionTextarea); ⌘/Ctrl+Enter sends. Mentions show as "@Name" while
// typing and are sent as `<@id>` tokens. The form is method="post" and its submit stays disabled until hydrated, so a
// native submit can never happen.
//
// `submit` gets the body (and the people it mentions) and resolves to true when it was accepted; on false the text is put back.
import type { SocialPerson } from '../../../shared/types/social'
import { Button } from '~/components/ui/button'

const props = withDefaults(defineProps<{
  collection: string
  item: string
  submit: (body: string, mentions: SocialPerson[]) => Promise<boolean>
  /** Body to start from, with `<@id>` tokens (editing). */
  initial?: string
  /** The people `initial` mentions. */
  initialMentions?: SocialPerson[]
  placeholder?: string
  submitLabel?: string
  autofocus?: boolean
  compact?: boolean
  cancellable?: boolean
}>(), { initial: '', initialMentions: () => [], placeholder: 'Add a comment…', submitLabel: 'Post', autofocus: false, compact: false, cancellable: false })
const emit = defineEmits<{ cancel: [] }>()

const { user } = useUserSession()
const me = computed(() => (user.value ? { name: [user.value.first_name, user.value.last_name].filter(Boolean).join(' ') || 'You', avatar: user.value.avatar, color: user.value.profile?.industry?.color ?? null } : null))
const MAX = COMMENT_MAX

// Display text uses "@Name"; `picked` remembers which names are real mentions.
const picked = ref<SocialPerson[]>([...props.initialMentions])
const text = ref(mentionDisplay(props.initial, picked.value))

const body = computed(() => normalizeCommentBody(mentionBody(text.value, picked.value)))
const length = computed(() => bodyLength(body.value))
const tooLong = computed(() => length.value > COMMENT_MAX)
const hydrated = ref(false)
const sending = ref(false)
const canSend = computed(() => hydrated.value && !sending.value && !!body.value && !tooLong.value && body.value !== normalizeCommentBody(props.initial))

const input = ref<{ focus: (end?: boolean) => void, close: () => void } | null>(null)
onMounted(() => {
  hydrated.value = true
  if (props.autofocus) input.value?.focus()
})

async function send() {
  if (!canSend.value) return
  sending.value = true
  const before = { text: text.value, picked: [...picked.value] }
  const value = body.value
  if (!props.initial) {
    text.value = ''
    picked.value = []
  }
  input.value?.close()
  try {
    const ok = await props.submit(value, before.picked.filter((p) => value.includes(`<@${p.id}>`)))
    if (!ok) {
      text.value = before.text
      picked.value = before.picked
    }
  } finally {
    sending.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    void send()
  } else if (e.key === 'Escape' && props.cancellable) {
    emit('cancel')
  }
}
</script>

<template>
  <form method="post" class="flex items-start gap-2" @submit.prevent="send">
    <SocialAvatar v-if="!compact" :person="me" size="sm" class="mt-1" />
    <div class="min-w-0 flex-1">
      <SocialMentionTextarea
        ref="input"
        v-model="text"
        v-model:picked="picked"
        :collection="collection"
        :item="item"
        :placeholder="placeholder"
        :invalid="tooLong"
        :class="cn('max-h-60 min-h-10 rounded-2xl bg-background/60 py-2 pr-20 text-sm', compact && 'min-h-9')"
        @keydown="onKeydown"
      >
        <div class="absolute right-1.5 bottom-1.5 flex items-center gap-1">
          <span v-if="length > MAX - 200" :class="cn('text-[10px] tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')">{{ MAX - length }}</span>
          <Button v-if="cancellable" type="button" variant="ghost" size="sm" class="h-7 rounded-full px-2 text-[11px] font-bold uppercase" @click="emit('cancel')">Cancel</Button>
          <Button type="submit" size="sm" :disabled="!canSend" class="h-7 rounded-full px-3 text-[11px] font-bold tracking-wider uppercase">
            <Icon v-if="sending" name="lucide:loader-circle" class="animate-spin" />
            {{ submitLabel }}
          </Button>
        </div>
      </SocialMentionTextarea>
      <p v-if="tooLong" class="mt-1 px-2 text-xs text-destructive">Comments can be up to {{ MAX }} characters.</p>
    </div>
  </form>
</template>
