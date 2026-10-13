<script setup lang="ts">
// "Notifications on this device": the push switch (README, "Push"). Permission is asked only when the member turns it
// on. On iPhone and iPad in a Safari tab it explains how to add the app to the Home Screen instead (push only reaches
// a Home Screen app there); blocked or unsupported, it says so. Renders nothing while push is off in this app.
// `preview` fixes the state for a design gallery; leave it out in the app.
import type { PushSupport } from '../../composables/useSocialPush'
import { Switch } from '~/components/ui/switch'

const props = defineProps<{
  /** Smaller, without the description (the bell). */
  compact?: boolean
  preview?: Partial<{ configured: boolean, ready: boolean, support: PushSupport, permission: NotificationPermission, enabled: boolean, busy: boolean, error: string | null, ios: boolean }>
}>()

const push = useSocialPush()
const state = computed(() => ({ ...push.state, ...props.preview }))
const appName = useRuntimeConfig().public.st8Auth?.appName || 'this app'
const id = useId()

const blocked = computed(() => state.value.support === 'supported' && state.value.permission === 'denied')
const disabled = computed(() => !state.value.ready || state.value.busy || state.value.support !== 'supported' || blocked.value)
const on = computed(() => state.value.enabled && !blocked.value)
const ios = computed(() => props.preview?.ios ?? isIosDevice())
const ipad = computed(() => ios.value && !props.preview && !/iPhone|iPod/.test(navigator.userAgent))

function toggle(value: boolean) {
  if (props.preview) return
  // enable() asks for permission first thing, inside this tap.
  void (value ? push.enable() : push.disable())
}
</script>

<template>
  <div v-if="state.configured" class="flex w-full flex-col gap-2" :class="compact ? 'text-xs' : 'text-sm'">
    <div v-if="state.support === 'install'" class="flex gap-3">
      <Icon name="lucide:smartphone" class="mt-0.5 shrink-0 text-muted-foreground" :class="compact ? 'size-4' : 'size-5'" />
      <div class="flex min-w-0 flex-col gap-1.5">
        <p class="font-bold">Get notifications on your {{ ios ? 'iPhone or iPad' : 'device' }}</p>
        <p class="text-muted-foreground">Notifications reach {{ appName }} only from your Home Screen:</p>
        <ol class="flex flex-col gap-1 text-muted-foreground">
          <li class="flex items-center gap-1.5">
            <span class="font-bold text-foreground">1.</span> Tap Share <Icon name="lucide:share" class="size-4 text-foreground" aria-label="(the square with an arrow)" />
          </li>
          <li class="flex items-center gap-1.5">
            <span class="font-bold text-foreground">2.</span> Choose Add to Home Screen <Icon name="lucide:square-plus" class="size-4 text-foreground" aria-hidden="true" />
          </li>
          <li class="flex items-start gap-1.5">
            <span class="font-bold text-foreground">3.</span> <span>Open it from your Home Screen and turn notifications on there.</span>
          </li>
        </ol>
      </div>
    </div>

    <template v-else>
      <div class="flex items-center gap-3">
        <Icon :name="on ? 'lucide:bell-ring' : 'lucide:bell-off'" class="shrink-0 text-muted-foreground" :class="compact ? 'size-4' : 'size-5'" />
        <label :for="id" class="min-w-0 flex-1 cursor-pointer font-bold" :class="{ 'cursor-default': disabled }">Notifications on this device</label>
        <Switch :id="id" :model-value="on" :disabled="disabled" @update:model-value="toggle" />
      </div>
      <p v-if="state.support === 'unsupported'" class="text-muted-foreground">This browser can't receive notifications.</p>
      <p v-else-if="blocked" class="text-muted-foreground">
        Notifications are blocked for {{ appName }} in this browser.
        <template v-if="ios">Allow them in Settings › Notifications on your {{ ipad ? 'iPad' : 'iPhone' }}, then come back.</template>
        <template v-else>Allow them in the site settings (the icon left of the address), then come back.</template>
      </p>
      <p v-else-if="!compact" class="text-muted-foreground">
        {{ on ? 'Replies, mentions, connection requests and notices reach you here, even when the app is closed.' : 'Get replies, mentions and connection requests here, even when the app is closed.' }}
      </p>
      <p v-if="state.error" class="text-destructive" role="alert">{{ state.error }}</p>
    </template>
  </div>
</template>
