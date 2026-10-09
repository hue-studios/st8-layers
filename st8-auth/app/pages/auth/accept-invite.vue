<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Accept your invitation', robots: 'noindex', referrer: 'no-referrer' })

const route = useRoute()
const { acceptInvite } = useAuth()
const { appName } = useRuntimeConfig().public.st8Auth
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
</script>

<template>
  <div class="flex flex-col gap-8">
    <AuthHeading title="You’re invited" :description="`Choose a password to activate your Southern Tier 8 account and join ${appName}.`" />
    <AuthInvalidLink v-if="!token" to="/login" action="Go to sign in">
      This invitation link is incomplete. Open the link from your invitation email again.
    </AuthInvalidLink>
    <AuthNewPasswordForm
      v-else
      :submit="(password) => acceptInvite(token, password)"
      action="Activate account"
      fallback-error="We couldn’t accept the invitation. The link may have expired."
    />
  </div>
</template>
