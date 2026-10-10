<script setup lang="ts">
// A target's reactions as one line ("👍🎉 Jen and 14 others"), opening the list of who reacted. Live from the shared
// summaries. Pairs with SocialReactionBar's `action` variant when the button sits in its own row.
const props = defineProps<{ collection: string, item: string | number }>()
const summary = useSocialSummary(() => props.collection, () => String(props.item))
const open = ref(false)

const names = computed(() => {
  const s = summary.value
  if (!s?.reactionTotal) return ''
  const lead = s.myReaction ? 'You' : s.reactors?.[0]?.name
  if (!lead) return String(s.reactionTotal)
  return s.reactionTotal === 1 ? lead : `${lead} and ${s.reactionTotal - 1} other${s.reactionTotal === 2 ? '' : 's'}`
})
</script>

<template>
  <div class="flex min-w-0">
    <button v-if="summary?.reactionTotal" type="button" class="flex min-w-0 items-center gap-1.5 text-xs opacity-80 hover:underline" @click="open = true">
      <SocialReactionGlyphs :reactions="summary.reactions" />
      <span class="truncate">{{ names }}</span>
    </button>
    <SocialReactorsDialog v-if="open" v-model:open="open" :collection="collection" :item="String(item)" />
  </div>
</template>
