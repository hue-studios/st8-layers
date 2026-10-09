<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Reset your password', robots: 'noindex' })

const route = useRoute()
const email = computed(() => (typeof route.query.email === 'string' ? route.query.email : ''))
</script>

<template>
  <div class="flex flex-col gap-8">
    <AuthHeading title="Reset password" description="Enter your account email and we’ll send you a link to choose a new password." />
    <AuthForgotPasswordForm :initial-email="email" />
    <p class="text-center text-sm text-muted-foreground">
      <NuxtLink to="/login" class="font-bold text-foreground underline-offset-4 hover:underline">Back to sign in</NuxtLink>
    </p>
  </div>
</template>
