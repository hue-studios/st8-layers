<script setup lang="ts">
// Write a comment, a reply or an edit. The textarea grows with its text; `@` opens member autocomplete (people in the
// thread, connections, discoverable members: the server decides); ⌘/Ctrl+Enter sends. Mentions show as "@Name" while
// typing and are sent as `<@id>` tokens. The form is method="post" and its submit stays disabled until hydrated, so a
// native submit can never happen.
//
// `submit` gets the body (and the people it mentions) and resolves to true when it was accepted; on false the text is put back.
import type { SocialPerson } from '../../../shared/types/social'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'

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
const toDisplay = (body: string) => body.replace(MENTION_TOKEN, (_, id: string) => `@${picked.value.find((p) => p.id === id.toLowerCase())?.name ?? 'member'}`)
const text = ref(toDisplay(props.initial))

function toBody(display: string) {
  let out = display
  // Longest names first, so "@Jen Ortiz-Smith" isn't half-matched by "@Jen Ortiz".
  for (const p of [...picked.value].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${p.name}`).join(`<@${p.id}>`)
  }
  return out
}

const body = computed(() => normalizeCommentBody(toBody(text.value)))
const length = computed(() => bodyLength(body.value))
const tooLong = computed(() => length.value > COMMENT_MAX)
const hydrated = ref(false)
const sending = ref(false)
const canSend = computed(() => hydrated.value && !sending.value && !!body.value && !tooLong.value && body.value !== normalizeCommentBody(props.initial))

const area = ref<{ $el: HTMLTextAreaElement } | null>(null)
const el = () => area.value?.$el ?? null
onMounted(() => {
  hydrated.value = true
  if (props.autofocus) {
    const t = el()
    t?.focus()
    t?.setSelectionRange(t.value.length, t.value.length)
  }
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
  closeMentions()
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

// ── @mentions ──────────────────────────────────────────────────────────────────────────────────────────────────
const query = ref<string | null>(null)
const anchor = ref(0) // index of the "@"
const results = ref<SocialPerson[]>([])
const active = ref(0)
const listId = useId()
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

function detect() {
  const t = el()
  if (!t || t.selectionStart !== t.selectionEnd) return closeMentions()
  const before = t.value.slice(0, t.selectionStart)
  const m = before.match(/(?:^|\s)@([\p{L}\p{M}'’.-]{0,30}(?: [\p{L}\p{M}'’.-]{0,30})?)$/u)
  if (!m) return closeMentions()
  anchor.value = before.length - m[1]!.length - 1
  if (query.value === m[1]) return
  query.value = m[1]!
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 150)
}

async function search() {
  const mine = ++seq
  try {
    const list = await $fetch<SocialPerson[]>('/api/social/mentions', { query: { q: query.value ?? '', collection: props.collection, item: props.item } })
    if (mine !== seq || query.value === null) return
    results.value = list
    active.value = 0
  } catch {
    results.value = []
  }
}

function closeMentions() {
  query.value = null
  results.value = []
  if (timer) clearTimeout(timer)
}

function choose(person: SocialPerson) {
  const t = el()
  if (!t) return
  const end = t.selectionStart
  const insert = `@${person.name} `
  text.value = text.value.slice(0, anchor.value) + insert + text.value.slice(end)
  if (!picked.value.some((p) => p.id === person.id)) picked.value.push(person)
  closeMentions()
  nextTick(() => {
    const pos = anchor.value + insert.length
    t.focus()
    t.setSelectionRange(pos, pos)
  })
}

// Let a click on a suggestion land before the list closes.
const onBlur = () => setTimeout(closeMentions, 150)

function onKeydown(e: KeyboardEvent) {
  const open = query.value !== null && results.value.length > 0
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    const n = results.value.length
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  } else if (open && (e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    choose(results.value[active.value]!)
  } else if (open && e.key === 'Escape') {
    e.preventDefault()
    closeMentions()
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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
    <div class="relative min-w-0 flex-1">
      <Textarea
        ref="area"
        v-model="text"
        name="body"
        :placeholder="placeholder"
        :aria-label="placeholder"
        :aria-invalid="tooLong || undefined"
        rows="1"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="query !== null && results.length > 0"
        :aria-controls="listId"
        :aria-activedescendant="query !== null && results.length ? `${listId}-${active}` : undefined"
        :class="cn('max-h-60 min-h-10 resize-none rounded-2xl bg-background/60 py-2 pr-20 text-sm', compact && 'min-h-9')"
        @input="detect"
        @click="detect"
        @keyup="(e: KeyboardEvent) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && detect()"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <div class="absolute right-1.5 bottom-1.5 flex items-center gap-1">
        <span v-if="length > MAX - 200" :class="cn('text-[10px] tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')">{{ MAX - length }}</span>
        <Button v-if="cancellable" type="button" variant="ghost" size="sm" class="h-7 rounded-full px-2 text-[11px] font-bold uppercase" @click="emit('cancel')">Cancel</Button>
        <Button type="submit" size="sm" :disabled="!canSend" class="h-7 rounded-full px-3 text-[11px] font-bold tracking-wider uppercase">
          <Icon v-if="sending" name="lucide:loader-circle" class="animate-spin" />
          {{ submitLabel }}
        </Button>
      </div>
      <ul
        v-if="query !== null && results.length"
        :id="listId"
        role="listbox"
        aria-label="Mention someone"
        class="absolute top-full left-0 z-50 mt-1 w-full max-w-xs overflow-hidden rounded-2xl border bg-popover p-1 text-popover-foreground shadow-xl"
      >
        <li
          v-for="(p, i) in results"
          :id="`${listId}-${i}`"
          :key="p.id"
          role="option"
          :aria-selected="i === active"
          :class="cn('flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5', i === active && 'bg-accent text-accent-foreground')"
          @mousedown.prevent="choose(p)"
          @mouseenter="active = i"
        >
          <SocialAvatar :person="p" size="xs" />
          <span class="min-w-0">
            <span class="block truncate text-sm font-bold">{{ p.name }}</span>
            <span v-if="p.title" class="block truncate text-[11px] text-muted-foreground">{{ p.title }}</span>
          </span>
        </li>
      </ul>
      <p v-if="tooLong" class="mt-1 px-2 text-xs text-destructive">Comments can be up to {{ MAX }} characters.</p>
    </div>
  </form>
</template>
