<script setup lang="ts">
// React to something. A tap toggles Like; a long press (touch) or hover (mouse) opens the picker: a popover on
// desktop, a drawer on phones. ArrowUp opens it from the keyboard. The summary ("👍🎉 Jen and 14 others") opens the
// list of who reacted.
//
// Two modes: give it `collection` + `item` and it uses the shared summaries (counts arrive batched, live over
// realtime); or also pass `state` (a comment's own counts) and it reports changes through `change`.
import type { ReactionCounts, ReactionKey, ReactionResult, ThreadSummary } from '../../../shared/types/social'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '~/components/ui/popover'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'

interface ReactionState { myReaction: ReactionKey | null, reactions: ReactionCounts, reactionTotal: number }

const props = withDefaults(defineProps<{
  collection: string
  item: string | number
  state?: ReactionState | null
  /**
   * `bar`: summary line above a full-width button. `compact`: one row. `text`: a small text button (comments).
   * `action`: the button alone, for an action row; pair it with SocialReactionSummary.
   */
  variant?: 'bar' | 'compact' | 'text' | 'action'
  disabled?: boolean
}>(), { state: null, variant: 'bar', disabled: false })
const emit = defineEmits<{ change: [state: ReactionState] }>()

const summary = props.state ? computed(() => undefined as ThreadSummary | undefined) : useSocialSummary(() => props.collection, () => String(props.item))
const targets = useSocialTargets()
const desktop = useSocialDesktop()
const { user } = useUserSession()

const local = ref<ReactionState | null>(props.state)
watch(() => props.state, (s) => (local.value = s))
const current = computed<ReactionState>(() => local.value ?? summary.value ?? { myReaction: null, reactions: {}, reactionTotal: 0 })
const mine = computed(() => current.value.myReaction)
const mineDef = computed(() => (mine.value ? reactionDef(mine.value) : null))

const names = computed(() => {
  const total = current.value.reactionTotal
  if (!total) return ''
  const first = summary.value?.reactors?.[0]
  const lead = mine.value ? 'You' : first?.name
  if (!lead) return String(total)
  return total === 1 ? lead : `${lead} and ${total - 1} other${total === 2 ? '' : 's'}`
})

function apply(state: ReactionState, next: ReactionKey | null): ReactionState {
  let reactions = state.reactions
  if (state.myReaction) reactions = bumpReaction(reactions, state.myReaction, -1)
  if (next) reactions = bumpReaction(reactions, next, 1)
  return { myReaction: next, reactions, reactionTotal: Object.values(reactions).reduce((a, b) => a + (b ?? 0), 0) }
}

function write(state: ReactionState) {
  if (props.state) {
    local.value = state
    emit('change', state)
  } else if (summary.value) {
    targets.setSummary({ ...summary.value, ...state })
  }
}

const busy = ref(false)
let queued: ReactionKey | null | undefined
async function set(next: ReactionKey | null) {
  if (props.disabled) return
  pickerOpen.value = false
  const before = current.value
  write(apply(before, next))
  if (busy.value) {
    queued = next // a fast second tap: send the final choice when the first request returns
    return
  }
  busy.value = true
  try {
    let send: ReactionKey | null | undefined = next
    while (send !== undefined) {
      queued = undefined
      const res = await $fetch<ReactionResult>('/api/social/reactions', { method: 'PUT', body: { collection: props.collection, item: String(props.item), reaction: send } })
      if (res.thread) targets.setSummary(res.thread)
      else if (queued === undefined) write({ myReaction: res.myReaction, reactions: res.reactions, reactionTotal: res.reactionTotal })
      send = queued
    }
  } catch (err) {
    write(before)
    toast.error(socialError(err, 'Your reaction wasn’t saved.'))
  } finally {
    busy.value = false
  }
}

const toggle = () => set(mine.value ? null : 'like')

// ── Picker: hover (mouse), long press (touch), ArrowUp (keyboard) ──────────────────────────────────────────────
const pickerOpen = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let pressTimer: ReturnType<typeof setTimeout> | null = null
let longPressed = false

function clearTimers() {
  if (hoverTimer) clearTimeout(hoverTimer)
  if (pressTimer) clearTimeout(pressTimer)
  hoverTimer = pressTimer = null
}
function onEnter(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || props.disabled) return
  clearTimers()
  hoverTimer = setTimeout(() => (pickerOpen.value = true), 450)
}
function onLeave(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  clearTimers()
  hoverTimer = setTimeout(() => (pickerOpen.value = false), 350)
}
function onDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' || props.disabled) return
  longPressed = false
  clearTimers()
  pressTimer = setTimeout(() => {
    longPressed = true
    pickerOpen.value = true
    navigator.vibrate?.(10)
  }, 450)
}
function onUp() {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = null
}
function onClick() {
  if (longPressed) {
    longPressed = false
    return
  }
  void toggle()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowUp' && !props.disabled) {
    e.preventDefault()
    pickerOpen.value = true
  }
}
onBeforeUnmount(clearTimers)

const reactorsOpen = ref(false)
const buttonLabel = computed(() => (mineDef.value ? `${mineDef.value.label} (tap to remove, ↑ for more)` : 'Like (hold or ↑ for more reactions)'))
const signedIn = computed(() => !!user.value)
</script>

<template>
  <div :class="cn(variant === 'bar' ? 'flex flex-col' : variant === 'action' ? 'flex' : 'flex items-center gap-2')">
    <!-- Summary -->
    <button
      v-if="variant !== 'text' && variant !== 'action' && current.reactionTotal"
      type="button"
      :class="cn('flex min-w-0 items-center gap-1.5 text-xs opacity-80 hover:underline', variant === 'bar' && 'py-2')"
      @click="reactorsOpen = true"
    >
      <SocialReactionGlyphs :reactions="current.reactions" />
      <span class="truncate">{{ variant === 'compact' ? current.reactionTotal : names }}</span>
    </button>

    <Popover :open="desktop && pickerOpen" @update:open="(v) => (pickerOpen = v)">
      <PopoverAnchor as-child>
        <Button
          type="button"
          :variant="variant === 'text' ? 'link' : 'ghost'"
          :size="variant === 'text' ? 'sm' : 'sm'"
          :disabled="disabled || !signedIn"
          :aria-label="buttonLabel"
          aria-haspopup="true"
          :aria-pressed="!!mine"
          :class="cn(
            'touch-manipulation select-none [-webkit-touch-callout:none]',
            variant === 'text'
              ? 'h-auto px-0 py-0 text-[11px] font-bold tracking-wider text-muted-foreground uppercase hover:no-underline'
              : 'text-xs font-bold tracking-widest uppercase',
            variant === 'bar' && 'w-full border-t border-glass-border',
            variant === 'action' && 'w-full',
            mine && 'text-brand',
          )"
          @pointerenter="onEnter"
          @pointerleave="onLeave"
          @pointerdown="onDown"
          @pointerup="onUp"
          @pointercancel="onUp"
          @contextmenu.prevent
          @click="onClick"
          @keydown="onKey"
        >
          <Icon v-if="mineDef" :name="mineDef.glyph" :class="variant === 'text' ? 'size-3.5' : 'size-4'" />
          <Icon v-else-if="variant !== 'text'" name="lucide:thumbs-up" class="size-4" />
          {{ mineDef?.label ?? 'Like' }}
        </Button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="6"
        class="w-auto rounded-full px-2 py-1 shadow-xl"
        @pointerenter="clearTimers"
        @pointerleave="onLeave"
        @open-auto-focus.prevent
      >
        <SocialReactionPicker :current="mine" @pick="(k) => set(k === mine ? null : k)" />
      </PopoverContent>
    </Popover>

    <span v-if="variant === 'text' && current.reactionTotal" class="contents">
      <button type="button" class="flex items-center gap-1 text-[11px] text-muted-foreground hover:underline" @click="reactorsOpen = true">
        <SocialReactionGlyphs :reactions="current.reactions" size="size-3.5" />
        <span>{{ current.reactionTotal }}</span>
      </button>
    </span>

    <Drawer v-if="!desktop" :open="pickerOpen" @update:open="(v) => (pickerOpen = v)">
      <DrawerContent class="pb-[env(safe-area-inset-bottom)]">
        <DrawerHeader class="px-5 pt-3 pb-1 text-left">
          <DrawerTitle class="eyebrow">React</DrawerTitle>
          <DrawerDescription class="sr-only">Choose a reaction</DrawerDescription>
        </DrawerHeader>
        <div class="px-3 pb-6">
          <SocialReactionPicker :current="mine" large @pick="(k) => set(k === mine ? null : k)" />
        </div>
      </DrawerContent>
    </Drawer>

    <SocialReactorsDialog v-if="reactorsOpen" v-model:open="reactorsOpen" :collection="collection" :item="String(item)" />
  </div>
</template>
