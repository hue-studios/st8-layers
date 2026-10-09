<script setup lang="ts">
// A target's comment thread: the composer, top-level comments newest first with their newest replies, "View more",
// live updates, and the moderator lock. `focus` scrolls to (and highlights) a comment once it's loaded.
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'

const props = withDefaults(defineProps<{ collection: string, item: string | number, focus?: string | null, autofocus?: boolean }>(), { focus: null, autofocus: false })

const thread = createThread(props.collection, String(props.item))
provide(SOCIAL_THREAD, thread)
const { state, summary, top, moreTop } = thread

onMounted(async () => {
  await thread.load()
  if (props.focus) {
    await nextTick()
    const el = document.getElementById(`comment-${props.focus}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.classList.add('ring-2', 'ring-primary')
    setTimeout(() => el?.classList.remove('ring-2', 'ring-primary'), 2500)
  }
})

const locked = computed(() => !!summary.value?.locked)
const canModerate = computed(() => !!state.viewer?.canModerate)
const count = computed(() => summary.value?.commentCount ?? 0)
</script>

<template>
  <section class="flex flex-col gap-4" :aria-label="`Comments (${count})`">
    <header class="flex items-center justify-between gap-2">
      <p class="eyebrow flex items-center gap-2">
        {{ count }} {{ count === 1 ? 'comment' : 'comments' }}
        <span v-if="locked" class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] normal-case tracking-normal">
          <Icon name="lucide:lock" class="size-3" /> Closed
        </span>
      </p>
      <DropdownMenu v-if="canModerate">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Moderate this thread">
            <Icon name="lucide:shield" class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem class="text-xs font-bold uppercase" @select="thread.setLocked(!locked)">
            <Icon :name="locked ? 'lucide:lock-open' : 'lucide:lock'" /> {{ locked ? 'Reopen comments' : 'Close comments' }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <p v-if="locked && !canModerate" class="flex items-center gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
      <Icon name="lucide:lock" class="size-4 shrink-0" /> Comments are closed.
    </p>
    <template v-else>
      <p v-if="locked" class="text-xs text-muted-foreground">Comments are closed to members. As a moderator you can still post.</p>
      <SocialComposer :collection="collection" :item="String(item)" :autofocus="autofocus" :submit="(body, mentions) => thread.post(body, mentions, null)" />
    </template>

    <div v-if="state.loading && !state.comments.size" class="flex flex-col gap-4" aria-busy="true">
      <div v-for="n in 2" :key="n" class="flex gap-2">
        <Skeleton class="size-8 shrink-0 rounded-full" />
        <Skeleton class="h-16 flex-1 rounded-2xl" />
      </div>
    </div>
    <p v-else-if="state.error" class="flex items-center gap-2 text-sm text-destructive">
      {{ state.error }}
      <Button variant="link" size="sm" class="h-auto p-0" @click="thread.load()">Retry</Button>
    </p>
    <p v-else-if="!top.length" class="py-2 text-center text-sm text-muted-foreground">No comments yet. Start the conversation.</p>

    <ol class="flex flex-col gap-4">
      <li v-for="c in top" :key="c.id">
        <SocialComment :comment="c" />
      </li>
    </ol>

    <Button v-if="moreTop > 0 && state.next" variant="ghost" size="sm" class="self-start text-xs font-bold tracking-wider uppercase" @click="thread.loadOlder()">
      <Icon name="lucide:chevron-down" /> View {{ moreTop }} more {{ moreTop === 1 ? 'comment' : 'comments' }}
    </Button>
  </section>
</template>
