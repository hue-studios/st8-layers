<script setup lang="ts">
// The header bell: a live unread count and the member's notifications, in a popover on desktop and a sheet on phones.
// Opening it marks what's shown as read.
import type { SocialNotification } from '../../../shared/types/social'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet'

const { loggedIn } = useUserSession()
const notifications = useSocialNotifications()
const { items, unread, loading, loaded, hasMore } = notifications
const desktop = useSocialDesktop()
const open = ref(false)
const now = useSocialClock()
const push = useSocialPush()

watch(open, (isOpen) => {
  if (!isOpen) return
  void notifications.load().then(() => {
    const ids = items.value.filter((n) => !n.read).map((n) => n.id)
    if (ids.length) setTimeout(() => notifications.markRead(ids), 1200)
  })
})

const badge = computed(() => (unread.value > 99 ? '99+' : String(unread.value)))
const badgeClass = 'absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] leading-none font-bold text-white tabular-nums'
const label = computed(() => (unread.value ? `Notifications, ${unread.value} unread` : 'Notifications'))

function go(n: SocialNotification) {
  open.value = false
  if (!n.read) void notifications.markRead([n.id])
  if (n.link) void navigateTo(n.link)
}
</script>

<template>
  <template v-if="loggedIn">
    <Popover v-if="desktop" v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="icon" class="relative rounded-full" :aria-label="label">
          <Icon name="lucide:bell" class="size-5" />
          <span v-if="unread" :class="badgeClass" aria-hidden="true">{{ badge }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-96 rounded-2xl p-0">
        <div class="flex items-center justify-between border-b border-glass-border px-4 py-3">
          <p class="eyebrow">Notifications</p>
          <Button v-if="unread" variant="link" size="sm" class="h-auto p-0 text-[11px] font-bold uppercase" @click="notifications.markRead('all')">Mark all read</Button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-1">
          <SocialNotificationList :items="items" :loading="loading && !loaded" :has-more="hasMore" :now="now" @open="go" @more="notifications.loadMore()" />
        </div>
        <div v-if="push.state.configured" class="border-t border-glass-border px-4 py-3">
          <SocialPushSwitch compact />
        </div>
      </PopoverContent>
    </Popover>
    <template v-else>
      <Button variant="ghost" size="icon" class="relative rounded-full" :aria-label="label" @click="open = true">
        <Icon name="lucide:bell" class="size-5" />
        <span v-if="unread" :class="badgeClass" aria-hidden="true">{{ badge }}</span>
      </Button>
      <Sheet v-model:open="open">
        <SheetContent side="right" class="w-full gap-0 p-0 sm:max-w-sm">
          <SheetHeader class="border-b border-glass-border px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-3 text-left">
            <SheetTitle class="eyebrow">Notifications</SheetTitle>
            <SheetDescription class="sr-only">Replies, mentions, reactions and moderation notices</SheetDescription>
            <Button v-if="unread" variant="link" size="sm" class="h-auto self-start p-0 text-[11px] font-bold uppercase" @click="notifications.markRead('all')">Mark all read</Button>
          </SheetHeader>
          <div class="min-h-0 flex-1 overflow-y-auto p-1" :class="{ 'pb-[env(safe-area-inset-bottom)]': !push.state.configured }">
            <SocialNotificationList :items="items" :loading="loading && !loaded" :has-more="hasMore" :now="now" @open="go" @more="notifications.loadMore()" />
          </div>
          <div v-if="push.state.configured" class="border-t border-glass-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <SocialPushSwitch compact />
          </div>
        </SheetContent>
      </Sheet>
    </template>
  </template>
</template>
