<script setup lang="ts">
// A form-level message: an error from the server, or a note (account exists, password updated…).
// Alert lays out a direct <svg> icon column; @nuxt/icon renders a <span>, so the column is set here.
import { Alert, AlertDescription } from '~/components/ui/alert'

withDefaults(defineProps<{ tone?: 'error' | 'info' | 'success' }>(), { tone: 'info' })
</script>

<template>
  <Alert
    :variant="tone === 'error' ? 'destructive' : 'default'"
    :role="tone === 'error' ? 'alert' : 'status'"
    :class="cn('grid-cols-[1rem_1fr] gap-x-3 rounded-2xl', tone === 'success' && 'border-primary/50', tone === 'info' && 'border-glass-border bg-glass')"
  >
    <Icon :name="{ error: 'lucide:circle-alert', info: 'lucide:info', success: 'lucide:circle-check' }[tone]" class="size-4 translate-y-0.5" />
    <AlertDescription><slot /></AlertDescription>
  </Alert>
</template>
