<script setup lang="ts">
defineProps<{ title: string, description?: string }>()
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold tracking-wider uppercase">{{ title }}</h1>
    <p v-if="description || $slots.default" class="mt-2 text-sm text-muted-foreground">
      <slot>{{ description }}</slot>
    </p>
  </div>
</template>
