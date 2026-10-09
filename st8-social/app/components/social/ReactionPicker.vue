<script setup lang="ts">
// The six reactions as big Fluent Emoji buttons. The current one is ringed; picking it again clears it.
import type { ReactionKey } from '../../../shared/types/social'

defineProps<{ current: ReactionKey | null, large?: boolean }>()
const emit = defineEmits<{ pick: [key: ReactionKey] }>()
const reactions = REACTIONS
</script>

<template>
  <div role="group" aria-label="Reactions" :class="cn('flex items-end', large ? 'justify-between gap-1' : 'gap-0.5')">
    <button
      v-for="r in reactions"
      :key="r.key"
      type="button"
      :aria-label="r.label"
      :aria-pressed="current === r.key"
      :title="r.label"
      :class="cn(
        'group/reaction flex flex-col items-center gap-1 rounded-2xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring',
        large ? 'min-w-0 flex-1 py-2' : 'p-1 hover:-translate-y-1 hover:scale-125 focus-visible:scale-125',
        current === r.key && 'bg-primary/15',
      )"
      @click="emit('pick', r.key)"
    >
      <Icon :name="r.glyph" :class="large ? 'size-10' : 'size-8'" />
      <span v-if="large" class="text-[9px] leading-tight font-bold uppercase">{{ r.label }}</span>
    </button>
  </div>
</template>
