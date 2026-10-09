<script setup lang="ts">
// Who reacted, filterable by reaction.
import type { ReactionCounts, ReactionKey, SocialPerson } from '../../../shared/types/social'
import { Skeleton } from '~/components/ui/skeleton'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ collection: string, item: string }>()

const { data, status } = useFetch<{ reactors: { person: SocialPerson, reaction: ReactionKey }[], reactions: ReactionCounts, reactionTotal: number }>('/api/social/reactions', {
  query: { collection: props.collection, item: props.item },
  server: false,
  key: `reactors-${props.collection}-${props.item}`,
})
const filter = ref<ReactionKey | 'all'>('all')
const tabs = computed(() => topReactions(data.value?.reactions ?? {}, 6).map((k) => ({ ...reactionDef(k), count: data.value!.reactions[k] ?? 0 })))
const list = computed(() => (data.value?.reactors ?? []).filter((r) => filter.value === 'all' || r.reaction === filter.value))
const profileLink = useSocialProfileLink()
</script>

<template>
  <ResponsiveDialog v-model:open="open" title="Reactions">
    <div class="no-scrollbar -mx-1 mb-3 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter by reaction">
      <button
        type="button"
        role="tab"
        :aria-selected="filter === 'all'"
        :class="cn('shrink-0 rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase', filter === 'all' ? 'bg-foreground text-background' : 'bg-muted')"
        @click="filter = 'all'"
      >
        All {{ data?.reactionTotal ?? '' }}
      </button>
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="filter === t.key"
        :aria-label="`${t.label}: ${t.count}`"
        :class="cn('flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold', filter === t.key ? 'bg-foreground text-background' : 'bg-muted')"
        @click="filter = t.key"
      >
        <Icon :name="t.glyph" class="size-4" /> {{ t.count }}
      </button>
    </div>
    <div v-if="status === 'pending' && !data" class="flex flex-col gap-3">
      <Skeleton v-for="n in 3" :key="n" class="h-10 w-full rounded-xl" />
    </div>
    <ul v-else class="flex flex-col gap-1">
      <li v-for="r in list" :key="r.person.id" class="flex items-center gap-3 rounded-xl px-1 py-1.5">
        <span class="relative">
          <SocialAvatar :person="r.person" size="md" />
          <Icon :name="reactionDef(r.reaction).glyph" class="absolute -right-1 -bottom-1 size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <NuxtLink v-if="profileLink(r.person.id)" :to="profileLink(r.person.id)!" class="block truncate text-sm font-bold hover:underline">{{ r.person.name }}</NuxtLink>
          <span v-else class="block truncate text-sm font-bold">{{ r.person.name }}</span>
          <span v-if="r.person.title" class="block truncate text-xs text-muted-foreground">{{ r.person.title }}</span>
        </span>
      </li>
      <li v-if="!list.length" class="py-6 text-center text-sm text-muted-foreground">No reactions yet.</li>
    </ul>
  </ResponsiveDialog>
</template>
