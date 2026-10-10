<script setup lang="ts">
import { Field, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'

const props = defineProps<{ initialEmail?: string }>()
const { requestPasswordReset } = useAuth()

const email = ref(props.initialEmail ?? '')
const sentTo = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await requestPasswordReset(email.value)
    sentTo.value = email.value.trim().toLowerCase()
  } catch (err) {
    error.value = authError(err, 'We couldn’t send the link. Please try again.').message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="sentTo" class="flex flex-col gap-6">
    <AuthNotice tone="success">
      If there’s an account for <strong class="font-bold">{{ sentTo }}</strong>, a reset link is on its way. It expires in 1 hour.
    </AuthNotice>
    <p class="text-sm text-muted-foreground">
      Nothing arrived? Check spam, or
      <button type="button" class="font-bold text-foreground underline-offset-4 hover:underline" @click="sentTo = ''">try again</button>.
    </p>
  </div>
  <form v-else method="post" class="flex flex-col gap-6" novalidate @submit.prevent="submit">
    <AuthNotice v-if="error" tone="error">{{ error }}</AuthNotice>
    <FieldGroup>
      <Field>
        <FieldLabel for="forgot-email" class="eyebrow">Email</FieldLabel>
        <Input id="forgot-email" v-model="email" type="email" name="email" autocomplete="email" inputmode="email" required class="rounded-[var(--st8-auth-radius,9999px)] px-4" />
      </Field>
    </FieldGroup>
    <AuthSubmitButton :loading="loading">Send reset link</AuthSubmitButton>
  </form>
</template>
