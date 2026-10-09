<script setup lang="ts">
// The top reactions on something, as overlapping Fluent Emoji glyphs (the "👍🎉" in "👍🎉 Jen and 14 others").
import type { ReactionCounts } from '../../../shared/types/social'

const props = withDefaults(defineProps<{ reactions: ReactionCounts, limit?: number, size?: string }>(), { limit: 3, size: 'size-4' })
const top = computed(() => topReactions(props.reactions, props.limit).map(reactionDef))
</script>

<template>
  <span v-if="top.length" class="inline-flex items-center -space-x-1" aria-hidden="true">
    <span v-for="r in top" :key="r.key" class="inline-flex rounded-full bg-background p-px ring-1 ring-background">
      <Icon :name="r.glyph" :class="size" />
    </span>
  </span>
</template>
