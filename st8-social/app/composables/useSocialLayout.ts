import { useMediaQuery } from '@vueuse/core'

/**
 * True from the `md` breakpoint up, where dialogs, popovers and hover apply; below it the layer uses drawers and
 * long-press. False during SSR (mobile first).
 */
export function useSocialDesktop() {
  return useMediaQuery('(min-width: 768px)', { ssrWidth: 0 })
}

/** `/members/:id` → `/members/<id>`, from public.st8Social.profilePath. Null when the host doesn't link names. */
export function useSocialProfileLink() {
  const path = (useRuntimeConfig().public.st8Social as { profilePath?: string } | undefined)?.profilePath
  return (id: string | null | undefined) => (path && id ? path.replace(':id', id) : null)
}

/** "3h", "2d", "just now": compact, for comment metadata. */
export function socialAgo(value: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(value).getTime()) / 1000)
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86_400) return `${Math.round(s / 3600)}h`
  if (s < 604_800) return `${Math.round(s / 86_400)}d`
  if (s < 31_536_000) return `${Math.round(s / 604_800)}w`
  return `${Math.round(s / 31_536_000)}y`
}

/** "Friday, October 9, 2026 at 3:12 PM", for tooltips. */
export const socialDateTime = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })

/** The message of an API error ($fetch / ofetch), or a fallback. */
export function socialError(err: unknown, fallback = 'Something went wrong. Please try again.') {
  const e = err as { data?: { message?: string }, statusMessage?: string, statusCode?: number }
  return e?.data?.message || (e?.statusCode && e.statusCode < 500 ? e.statusMessage : '') || fallback
}

const clock = ref(Date.now())
let ticking = false

/** A shared minute clock (epoch ms) so relative times ("5m") stay current without a timer per comment. */
export function useSocialClock() {
  if (import.meta.client && !ticking) {
    ticking = true
    setInterval(() => (clock.value = Date.now()), 60_000)
  }
  return readonly(clock)
}
