<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Join', robots: 'noindex' })

const route = useRoute()
const { appName } = useRuntimeConfig().public.st8Auth
</script>

<template>
  <div class="flex flex-col gap-8">
    <AuthHeading :title="`Join ${appName}`" :description="`Create your Southern Tier 8 account and join ${appName}.`" />
    <AuthRegisterForm />
    <p class="text-center text-sm text-muted-foreground">
      Already a member?
      <NuxtLink :to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : {} }" class="font-bold text-foreground underline-offset-4 hover:underline">
        Sign in
      </NuxtLink>
    </p>
  </div>
</template>
