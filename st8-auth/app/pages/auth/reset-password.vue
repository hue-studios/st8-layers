<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Choose a new password', robots: 'noindex', referrer: 'no-referrer' })

const route = useRoute()
const { resetPassword } = useAuth()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

async function submit(password: string) {
  await resetPassword(token.value, password)
  await navigateTo({ path: '/login', query: { reset: '1' } }, { replace: true })
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <AuthHeading title="New password" description="Choose a new password for your Southern Tier 8 account." />
    <AuthInvalidLink v-if="!token" to="/auth/forgot-password" action="Request a new link">
      This reset link is incomplete. Open the link from your email again, or request a new one.
    </AuthInvalidLink>
    <AuthNewPasswordForm v-else :submit="submit" action="Save password" fallback-error="We couldn’t reset your password. Please try again." />
  </div>
</template>
