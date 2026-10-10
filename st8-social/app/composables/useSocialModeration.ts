import { useEventListener } from '@vueuse/core'
import type { ModerationSummary, QueueAction } from '../../shared/types/social'

// Whether the signed-in member moderates this app, and how many reported targets wait (the menu badge). One app-wide
// copy: loaded once, refreshed when the tab returns and whenever the bell's unread count moves (a `report`
// notification is how moderators hear about new reports).

const summary = ref<ModerationSummary | null>(null)
let started = false
let inflight: Promise<void> | null = null

function refresh() {
  inflight ??= $fetch<ModerationSummary>('/api/social/moderation/summary')
    .then((s) => void (summary.value = s))
    .catch(() => {})
    .finally(() => (inflight = null))
  return inflight
}

function start() {
  if (started || import.meta.server) return
  started = true
  const { loggedIn } = useUserSession()
  effectScope(true).run(() => {
    watch(loggedIn, (ok) => (ok ? void refresh() : (summary.value = null)), { immediate: true })
    watch(() => useSocialNotifications().unread.value, () => loggedIn.value && summary.value?.canModerate && void refresh())
    useEventListener(document, 'visibilitychange', () => document.visibilityState === 'visible' && loggedIn.value && void refresh())
  })
}

/** What the queue's buttons say. */
export const QUEUE_ACTION_LABELS: Record<QueueAction, string> = {
  dismiss: 'Leave it up',
  hide: 'Hide',
  unhide: 'Unhide',
  remove: 'Remove',
  lock: 'Close comments',
  unlock: 'Reopen comments',
  clear: 'Clear content',
  refer: 'Refer to admins',
  suspend: 'Suspend',
}

/** How the log names each action. */
export const LOG_ACTION_LABELS: Record<string, string> = {
  hide: 'Hid',
  unhide: 'Unhid',
  remove: 'Removed',
  lock: 'Closed comments on',
  unlock: 'Reopened comments on',
  dismiss_report: 'Left up',
  clear_profile: 'Cleared',
  refer: 'Referred to admins:',
  suspend_user: 'Suspended',
  unsuspend_user: 'Restored',
  auto_hide: 'Hid after reports:',
}

export function useSocialModeration() {
  start()
  return {
    summary: readonly(summary),
    canModerate: computed(() => !!summary.value?.canModerate),
    isAdmin: computed(() => summary.value?.canModerate === true && summary.value.role === 'admin'),
    pending: computed(() => summary.value?.pending ?? 0),
    refresh,
  }
}
