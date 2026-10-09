<script setup lang="ts">
defineProps<{ to: string, action: string }>()
</script>

<template>
  <div class="flex flex-col gap-6">
    <AuthNotice tone="error"><slot /></AuthNotice>
    <NuxtLink :to="to" class="text-sm font-bold underline-offset-4 hover:underline">{{ action }} →</NuxtLink>
  </div>
</template>
