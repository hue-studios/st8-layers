<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Sign in', robots: 'noindex' })

const route = useRoute()
const { appName } = useRuntimeConfig().public.st8Auth
const email = computed(() => (typeof route.query.email === 'string' ? route.query.email : ''))
const notice = computed(() => {
  if (route.query.exists) return 'You already have a Southern Tier 8 account. Sign in with its password to join, or reset it.'
  if (route.query.reset) return 'Your password is updated. Sign in with the new one.'
  if (route.query.invited) return 'Your account is ready. Sign in to continue.'
  return ''
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <AuthHeading title="Sign in">
      Use your Southern Tier 8 account: one email and password for every ST8 site. Partners: use the ones you manage
      your listing with.
    </AuthHeading>
    <AuthNotice v-if="notice" :tone="route.query.reset ? 'success' : 'info'">{{ notice }}</AuthNotice>
    <AuthLoginForm :initial-email="email" />
    <p class="text-center text-sm text-muted-foreground">
      New here?
      <NuxtLink :to="{ path: '/auth/register', query: route.query.redirect ? { redirect: route.query.redirect } : {} }" class="font-bold text-foreground underline-offset-4 hover:underline">
        Join {{ appName }}
      </NuxtLink>
    </p>
  </div>
</template>
