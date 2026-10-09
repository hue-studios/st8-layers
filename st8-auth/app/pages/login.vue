<script setup lang="ts">
// Sign-in shell. Phase 2 wires the form to /api/auth/login (Directus credentials, sealed nuxt-auth-utils session).
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Sign in', robots: 'noindex' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold tracking-wider uppercase">Sign in</h1>
      <p class="mt-2 text-sm text-muted-foreground">One Southern Tier 8 account works across Insider, the Summit and the Portal.</p>
    </div>
    <form class="flex flex-col gap-4" @submit.prevent>
      <fieldset disabled class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="email" class="eyebrow">Email</Label>
          <Input id="email" type="email" autocomplete="email" class="rounded-full px-4" />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="password" class="eyebrow">Password</Label>
          <Input id="password" type="password" autocomplete="current-password" class="rounded-full px-4" />
        </div>
        <Button type="submit" class="rounded-full font-bold tracking-wider uppercase">Sign in</Button>
      </fieldset>
      <p class="text-center text-sm text-muted-foreground" role="status">Member sign-in opens soon.</p>
    </form>
  </div>
</template>
