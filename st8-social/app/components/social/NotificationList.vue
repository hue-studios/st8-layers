<script setup lang="ts">
// The rows inside the notification bell.
import type { SocialNotification } from '../../../shared/types/social'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'

defineProps<{ items: readonly SocialNotification[], loading: boolean, hasMore: boolean, now: number }>()
const emit = defineEmits<{ open: [n: SocialNotification], more: [] }>()
const icons: Record<string, string> = {
  reply: 'lucide:message-circle',
  mention: 'lucide:at-sign',
  moderation: 'lucide:shield',
  connection_request: 'lucide:user-plus',
  connection_accepted: 'lucide:user-check',
  intro: 'lucide:handshake',
}
</script>

<template>
  <div v-if="loading" class="flex flex-col gap-2 p-2">
    <Skeleton v-for="n in 3" :key="n" class="h-12 w-full rounded-xl" />
  </div>
  <div v-else-if="!items.length" class="flex flex-col items-center gap-2 px-4 py-8 text-center">
    <Icon name="lucide:bell-off" class="size-6 text-muted-foreground" />
    <p class="text-sm text-muted-foreground">You’re all caught up.</p>
  </div>
  <ul v-else class="flex flex-col">
    <li v-for="n in items" :key="n.id">
      <button
        type="button"
        :class="cn('flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted', !n.read && 'bg-primary/10')"
        @click="emit('open', n)"
      >
        <span class="relative mt-0.5">
          <SocialAvatar v-if="n.actor" :person="n.actor" size="md" />
          <span v-else class="flex size-10 items-center justify-center rounded-full bg-muted"><Icon name="lucide:shield" class="size-5" /></span>
          <span class="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-background shadow">
            <Icon v-if="n.type === 'reaction' && n.reaction" :name="reactionDef(n.reaction).glyph" class="size-4" />
            <Icon v-else :name="icons[n.type] ?? 'lucide:bell'" class="size-3" />
          </span>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm leading-5">
            <template v-if="n.actor"><strong>{{ n.actor.name }}</strong>{{ ' ' }}</template>{{ n.text }}
          </span>
          <span v-if="n.snippet" class="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">“{{ n.snippet }}”</span>
          <span class="mt-0.5 block text-[11px] text-muted-foreground">{{ socialAgo(n.createdAt, now) }}</span>
        </span>
        <span v-if="!n.read" class="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
      </button>
    </li>
    <li v-if="hasMore" class="p-2">
      <Button variant="ghost" size="sm" class="w-full text-xs font-bold uppercase" @click="emit('more')">Load more</Button>
    </li>
  </ul>
</template>
