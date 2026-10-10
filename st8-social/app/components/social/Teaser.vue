<script setup lang="ts">
// Another app's activity on the same row, as a reason to join it: "👍🎉 8 people are discussing this on the Summit
// app · Join". Counts and reaction glyphs only; nothing shows below the threshold or when no app is configured
// (public.st8Social.teasers). The join link carries `via` so the other app records where its new member came from.
import type { SocialTeaser, SocialTeaserApp } from '../../../shared/types/social'
import { Button } from '~/components/ui/button'

const props = defineProps<{ collection: string, item: string | number }>()
const apps = (useRuntimeConfig().public.st8Social as { teasers?: SocialTeaserApp[] }).teasers ?? []
const key = computed(() => `${props.collection}:${props.item}`)
const { data } = useFetch<{ app: string, teasers: Record<string, SocialTeaser[]> }>('/api/social/teasers', {
  query: computed(() => ({ t: key.value })),
  key: `social-teasers-${key.value}`,
  server: false,
  immediate: apps.length > 0,
  default: () => ({ app: '', teasers: {} }),
})

const fill = (template: string) =>
  template
    .replace(/\{via\}/g, encodeURIComponent(`${data.value?.app}:${props.collection}:${props.item}`))
    .replace(/\{collection\}/g, encodeURIComponent(props.collection))
    .replace(/\{item\}/g, encodeURIComponent(String(props.item)))

const items = computed(() =>
  (data.value?.teasers[key.value] ?? [])
    .map((t) => ({ ...t, def: apps.find((a) => a.app === t.app) }))
    .filter((t) => !!t.def)
    .map((t) => ({ ...t, href: t.member ? (t.def!.openUrl ? fill(t.def!.openUrl) : null) : fill(t.def!.joinUrl) })),
)
const reactionsOf = (keys: SocialTeaser['reactions']) => Object.fromEntries(keys.map((k, i) => [k, keys.length - i]))
</script>

<template>
  <div v-if="items.length" class="flex flex-col gap-2">
    <aside
      v-for="t in items"
      :key="t.app"
      class="glass-panel flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
      :aria-label="`Activity on ${t.def!.label}`"
    >
      <p class="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <SocialReactionGlyphs v-if="t.reactions.length" :reactions="reactionsOf(t.reactions)" />
        <Icon v-else name="lucide:messages-square" class="size-4 shrink-0 text-brand" />
        <span>
          <strong>{{ t.people }} people</strong> are discussing this on {{ t.def!.label }}<template v-if="t.comments"> ({{ t.comments }} comment{{ t.comments === 1 ? '' : 's' }})</template>.
        </span>
      </p>
      <Button v-if="t.href" as-child size="sm" variant="outline" class="shrink-0 self-start rounded-full text-xs font-bold tracking-wider uppercase sm:self-auto">
        <a :href="t.href" rel="noopener">{{ t.member ? `Open ${t.def!.label}` : `Join ${t.def!.label}` }} <Icon name="lucide:arrow-up-right" /></a>
      </Button>
    </aside>
  </div>
</template>
