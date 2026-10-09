import type { InviteRedeemResult } from '../../shared/types/network'

// Carrying an invite through sign-up or sign-in. The landing page remembers the code in a cookie only when the visitor
// clicks to join or sign in (so a link alone can never connect a signed-in member with someone), and the code is
// redeemed as soon as they're signed in: by the landing page when they come back to it, or by the
// st8-network-invite plugin on whatever page they reach first (onboarding, say).

const WEEK = 60 * 60 * 24 * 7

export function useNetworkInvite() {
  const name = (useRuntimeConfig().public.st8Network as { inviteCookie?: string } | undefined)?.inviteCookie || 'st8_invite'
  const cookie = useCookie<string | null>(name, { maxAge: WEEK, sameSite: 'lax', path: '/', default: () => null })

  async function redeem(code: string): Promise<InviteRedeemResult> {
    try {
      const result = await $fetch<InviteRedeemResult>('/api/invites/redeem', { method: 'POST', body: { code } })
      if (cookie.value === code) cookie.value = null
      return result
    } catch (err) {
      // A link that can't be used now (expired, used, invalid) won't work later either; a 429 or 5xx might.
      const status = (err as { statusCode?: number }).statusCode ?? 0
      if (status >= 400 && status < 500 && status !== 429 && cookie.value === code) cookie.value = null
      throw new Error(socialError(err), { cause: err })
    }
  }

  return {
    /** The code waiting to be redeemed, if any. */
    pending: computed(() => cookie.value),
    remember: (code: string) => (cookie.value = code),
    forget: () => (cookie.value = null),
    redeem,
  }
}
