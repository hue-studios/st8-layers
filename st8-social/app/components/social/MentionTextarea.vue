<script setup lang="ts">
// A textarea with `@` member autocomplete, shared by SocialComposer and host composers (Insider's post composer). The
// text shows "@Name" for each picked person; mentionBody() (shared/utils/social.ts) turns it into `<@id>` tokens for
// sending. The list offers people in the target's thread (when `collection` + `item` are given), connections, then
// discoverable members: the server decides. Keys the list doesn't use (⌘/Ctrl+Enter, Escape) reach the parent.
import type { HTMLAttributes } from 'vue'
import type { SocialPerson } from '../../../shared/types/social'
import { Textarea } from '~/components/ui/textarea'

const text = defineModel<string>({ required: true })
const picked = defineModel<SocialPerson[]>('picked', { required: true })
const props = withDefaults(defineProps<{
  collection?: string | null
  item?: string | null
  placeholder?: string
  name?: string
  id?: string
  rows?: number
  invalid?: boolean
  class?: HTMLAttributes['class']
}>(), { collection: null, item: null, placeholder: '', name: 'body', id: undefined, rows: 1, invalid: false, class: undefined })
const emit = defineEmits<{ keydown: [e: KeyboardEvent] }>()

const area = ref<{ $el: HTMLTextAreaElement } | null>(null)
const el = () => area.value?.$el ?? null

const query = ref<string | null>(null)
const anchor = ref(0) // index of the "@"
const results = ref<SocialPerson[]>([])
const active = ref(0)
const listId = useId()
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

function detect() {
  const t = el()
  if (!t || t.selectionStart !== t.selectionEnd) return close()
  const before = t.value.slice(0, t.selectionStart)
  const m = before.match(/(?:^|\s)@([\p{L}\p{M}'’.-]{0,30}(?: [\p{L}\p{M}'’.-]{0,30})?)$/u)
  if (!m) return close()
  anchor.value = before.length - m[1]!.length - 1
  if (query.value === m[1]) return
  query.value = m[1]!
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 150)
}

async function search() {
  const mine = ++seq
  try {
    const target = props.collection && props.item ? { collection: props.collection, item: props.item } : {}
    const list = await $fetch<SocialPerson[]>('/api/social/mentions', { query: { q: query.value ?? '', ...target } })
    if (mine !== seq || query.value === null) return
    results.value = list
    active.value = 0
  } catch {
    results.value = []
  }
}

function close() {
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
  if (!picked.value.some((p) => p.id === person.id)) picked.value = [...picked.value, person]
  close()
  nextTick(() => {
    const pos = anchor.value + insert.length
    t.focus()
    t.setSelectionRange(pos, pos)
  })
}

// Let a click on a suggestion land before the list closes.
const onBlur = () => setTimeout(close, 150)

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
    close()
  } else {
    emit('keydown', e)
  }
}

defineExpose({
  focus(end = true) {
    const t = el()
    t?.focus()
    if (end) t?.setSelectionRange(t.value.length, t.value.length)
  },
  close,
})
</script>

<template>
  <div class="relative min-w-0">
    <Textarea
      :id="id"
      ref="area"
      v-model="text"
      :name="name"
      :rows="rows"
      :placeholder="placeholder"
      :aria-label="placeholder || undefined"
      :aria-invalid="invalid || undefined"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="query !== null && results.length > 0"
      :aria-controls="listId"
      :aria-activedescendant="query !== null && results.length ? `${listId}-${active}` : undefined"
      :class="cn('resize-none', props.class)"
      @input="detect"
      @click="detect"
      @keyup="(e: KeyboardEvent) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && detect()"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <slot />
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
  </div>
</template>
