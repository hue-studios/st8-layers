<script setup lang="ts">
// Disabled until hydrated: before that, a click or Enter would submit the form natively instead of through useAuth.
// (The forms are method="post" too, so even a native submit never puts a password in the URL.)
import { Button } from '~/components/ui/button'

defineProps<{ loading?: boolean }>()
const ready = ref(false)
onMounted(() => (ready.value = true))
</script>

<template>
  <Button type="submit" :disabled="loading || !ready" class="w-full rounded-[var(--st8-auth-radius,9999px)] font-bold tracking-wider uppercase">
    <Icon v-if="loading" name="lucide:loader-circle" class="animate-spin" />
    <slot />
  </Button>
</template>
