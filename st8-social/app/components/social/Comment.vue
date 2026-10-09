<script setup lang="ts">
// One comment and (for the first two levels) its replies. Actions sit in a dropdown: reply, edit, delete, report,
// and for moderators hide / unhide / remove. Banners tell an author their comment is hidden, and show moderators
// what others can't see. Tombstones ("[deleted]", "Removed by a moderator") keep replies in context.
import type { ModerationAction, SocialComment } from '../../../shared/types/social'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Textarea } from '~/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'

const props = defineProps<{ comment: SocialComment }>()
const thread = inject(SOCIAL_THREAD)!
const { state } = thread
const profileLink = useSocialProfileLink()

const c = computed(() => props.comment)
const pending = computed(() => state.pending.has(c.value.id))
const replies = computed(() => (c.value.depth < 2 && c.value.status !== 'unavailable' ? thread.children(c.value.id) : []))
const more = computed(() => (c.value.depth < 2 ? thread.hidden(c.value.id) : 0))
const tombstone = computed(() => c.value.status === 'deleted' || c.value.status === 'removed' || c.value.status === 'unavailable')
const hidden = computed(() => c.value.status === 'hidden')
const hasActions = computed(() => !pending.value && Object.values(c.value.can).some(Boolean))
const authorLink = computed(() => profileLink(c.value.author?.id))
const now = useSocialClock()
const ago = computed(() => socialAgo(c.value.createdAt, now.value))

const editing = computed(() => state.editing === c.value.id)
const replying = computed(() => state.replyingTo === c.value.id)
function startReply() {
  state.editing = null
  state.replyingTo = c.value.id
}

// Delete confirmation, moderation reason, report.
const confirmDelete = ref(false)
const moderation = ref<ModerationAction | null>(null)
const reason = ref('')
const reportOpen = ref(false)
function startModeration(action: ModerationAction) {
  if (action === 'unhide') return void thread.moderate(c.value, 'unhide')
  reason.value = ''
  moderation.value = action
}
async function confirmModeration() {
  const action = moderation.value
  moderation.value = null
  if (action) await thread.moderate(c.value, action, reason.value.trim() || undefined)
}
</script>

<template>
  <article :id="`comment-${c.id}`" class="flex scroll-mt-24 gap-2 rounded-2xl transition-shadow" :aria-busy="pending || undefined">
    <NuxtLink v-if="authorLink && !tombstone" :to="authorLink" class="mt-0.5 shrink-0 rounded-full" :aria-label="c.author?.name">
      <SocialAvatar :person="c.author" :size="c.depth ? 'xs' : 'sm'" :class="c.depth ? 'mt-1' : ''" />
    </NuxtLink>
    <SocialAvatar v-else :person="tombstone ? null : c.author" :size="c.depth ? 'xs' : 'sm'" :class="cn('mt-0.5', c.depth && 'mt-1')" />

    <div class="min-w-0 flex-1">
      <div
        :class="cn(
          'relative rounded-2xl px-3 py-2',
          tombstone ? 'border border-dashed border-glass-border bg-transparent' : 'bg-muted/60 dark:bg-white/5',
          hidden && 'border border-dashed border-amber-500/60 bg-amber-500/5',
          pending && 'opacity-60',
        )"
      >
        <!-- Status banners -->
        <p v-if="hidden && c.mine && !state.viewer?.canModerate" class="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
          <Icon name="lucide:eye-off" class="size-3.5 shrink-0" />
          {{ c.autoHidden ? 'Hidden after several reports until a moderator reviews it.' : 'Hidden by a moderator.' }} Only you can see this.
        </p>
        <p v-else-if="hidden" class="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
          <Icon name="lucide:shield-alert" class="size-3.5 shrink-0" />
          {{ c.autoHidden ? 'Auto-hidden after reports.' : 'Hidden.' }} Members can’t see this; its author can.
        </p>

        <template v-if="tombstone">
          <p class="text-sm text-muted-foreground italic">
            {{ c.status === 'removed' ? 'Comment removed by a moderator.' : c.status === 'deleted' ? '[deleted]' : 'This comment isn’t available.' }}
          </p>
        </template>
        <template v-else>
          <header class="flex items-start justify-between gap-2">
            <div class="min-w-0 leading-tight">
              <NuxtLink v-if="authorLink" :to="authorLink" class="text-sm font-bold hover:underline">{{ c.author?.name ?? 'Member' }}</NuxtLink>
              <span v-else class="text-sm font-bold">{{ c.author?.name ?? 'Member' }}</span>
              <span v-if="c.author?.title" class="block truncate text-[11px] text-muted-foreground">{{ c.author.title }}</span>
            </div>
            <DropdownMenu v-if="hasActions">
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-sm" class="-mt-1 -mr-2 size-7 shrink-0 rounded-full" aria-label="Comment options">
                  <Icon name="lucide:ellipsis" class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem v-if="c.can.reply" class="text-xs font-bold uppercase" @select="startReply"><Icon name="lucide:reply" /> Reply</DropdownMenuItem>
                <DropdownMenuItem v-if="c.can.edit" class="text-xs font-bold uppercase" @select="state.editing = c.id"><Icon name="lucide:pencil" /> Edit</DropdownMenuItem>
                <DropdownMenuItem v-if="c.can.delete" variant="destructive" class="text-xs font-bold uppercase" @select="confirmDelete = true"><Icon name="lucide:trash-2" /> Delete</DropdownMenuItem>
                <DropdownMenuItem v-if="c.can.report" class="text-xs font-bold uppercase" @select="reportOpen = true"><Icon name="lucide:flag" /> Report</DropdownMenuItem>
                <template v-if="c.can.moderate">
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="eyebrow text-[10px]">Moderator</DropdownMenuLabel>
                  <DropdownMenuItem v-if="!hidden" class="text-xs font-bold uppercase" @select="startModeration('hide')"><Icon name="lucide:eye-off" /> Hide</DropdownMenuItem>
                  <DropdownMenuItem v-else class="text-xs font-bold uppercase" @select="startModeration('unhide')"><Icon name="lucide:eye" /> Unhide</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" class="text-xs font-bold uppercase" @select="startModeration('remove')"><Icon name="lucide:ban" /> Remove</DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <p v-if="c.replyTo" class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon name="lucide:corner-down-right" class="size-3" />
            <NuxtLink v-if="profileLink(c.replyTo.id)" :to="profileLink(c.replyTo.id)!" class="font-bold hover:underline">@{{ c.replyTo.name }}</NuxtLink>
            <span v-else class="font-bold">@{{ c.replyTo.name }}</span>
          </p>

          <SocialComposer
            v-if="editing"
            class="mt-2"
            :collection="state.collection"
            :item="state.item"
            :initial="c.body"
            :initial-mentions="c.mentions"
            submit-label="Save"
            placeholder="Edit your comment"
            compact
            autofocus
            cancellable
            :submit="(body) => thread.edit(c, body)"
            @cancel="state.editing = null"
          />
          <SocialCommentBody v-else class="mt-1" :body="c.body" :mentions="c.mentions" />
        </template>
      </div>

      <!-- Meta row -->
      <div v-if="!tombstone" class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-3">
        <SocialReactionBar
          v-if="!pending"
          collection="comments"
          :item="c.id"
          variant="text"
          :disabled="!c.can.react"
          :state="{ myReaction: c.myReaction, reactions: c.reactions, reactionTotal: c.reactionTotal }"
          @change="(s) => thread.patch(c.id, s)"
        />
        <Button v-if="c.can.reply && !pending" variant="link" size="sm" class="h-auto p-0 text-[11px] font-bold tracking-wider text-muted-foreground uppercase hover:no-underline" @click="startReply">
          Reply
        </Button>
        <Tooltip>
          <TooltipTrigger as-child>
            <time :datetime="c.createdAt" class="cursor-default text-[11px] text-muted-foreground">{{ pending ? 'Posting…' : ago }}</time>
          </TooltipTrigger>
          <TooltipContent>{{ socialDateTime(c.createdAt) }}</TooltipContent>
        </Tooltip>
        <span v-if="c.editedAt" class="text-[11px] text-muted-foreground">Edited</span>
      </div>

      <!-- Replies -->
      <div v-if="replies.length || more || replying" class="mt-3 flex flex-col gap-3">
        <Button v-if="more" variant="link" size="sm" class="h-auto self-start p-0 text-[11px] font-bold tracking-wider uppercase" @click="thread.expand(c.id)">
          <Icon name="lucide:corner-down-right" /> View {{ more }} more {{ more === 1 ? 'reply' : 'replies' }}
        </Button>
        <SocialComment v-for="r in replies" :key="r.id" :comment="r" />
      </div>
      <div v-if="replying" class="mt-3">
        <SocialComposer
          :collection="state.collection"
          :item="state.item"
          :placeholder="`Reply to ${c.author?.name ?? 'this comment'}…`"
          submit-label="Reply"
          autofocus
          cancellable
          :submit="(body, mentions) => thread.post(body, mentions, c)"
          @cancel="state.replyingTo = null"
        />
      </div>
    </div>

    <!-- Dialogs -->
    <ResponsiveDialog v-model:open="confirmDelete" title="Delete comment?" :description="c.replyCount ? 'It has replies, so it will show as [deleted] to keep them in context.' : 'This can’t be undone.'">
      <template #footer>
        <Button variant="ghost" class="rounded-full" @click="confirmDelete = false">Cancel</Button>
        <Button variant="destructive" class="rounded-full font-bold uppercase" @click="confirmDelete = false; thread.remove(c)">Delete</Button>
      </template>
    </ResponsiveDialog>

    <ResponsiveDialog
      :open="!!moderation"
      :title="moderation === 'remove' ? 'Remove comment' : 'Hide comment'"
      :description="moderation === 'remove' ? 'Its text is cleared for everyone and it shows as removed. This is logged.' : 'Members stop seeing it; its author still does. You can unhide it later. This is logged.'"
      @update:open="(v) => !v && (moderation = null)"
    >
      <label class="eyebrow mb-2 block text-[10px]" :for="`mod-reason-${c.id}`">Reason (optional, kept in the moderation log)</label>
      <Textarea :id="`mod-reason-${c.id}`" v-model="reason" rows="3" maxlength="500" class="rounded-xl text-sm" />
      <template #footer>
        <Button variant="ghost" class="rounded-full" @click="moderation = null">Cancel</Button>
        <Button :variant="moderation === 'remove' ? 'destructive' : 'default'" class="rounded-full font-bold uppercase" @click="confirmModeration">
          {{ moderation === 'remove' ? 'Remove' : 'Hide' }}
        </Button>
      </template>
    </ResponsiveDialog>

    <SocialReportDialog v-if="reportOpen" v-model:open="reportOpen" collection="comments" :item="c.id" label="comment" />
  </article>
</template>
