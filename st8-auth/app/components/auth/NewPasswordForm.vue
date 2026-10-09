<script setup lang="ts">
// Choose a password twice, then hand it to `submit` (password reset and invite acceptance).
import { Field, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'

const props = defineProps<{
  submit: (password: string) => Promise<void>
  action: string
  fallbackError: string
}>()

const MIN = 8
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')
const mismatch = computed(() => !!confirm.value && confirm.value !== password.value)

async function onSubmit() {
  error.value = ''
  if (password.value.length < MIN) {
    error.value = `Your password must be at least ${MIN} characters.`
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'The passwords don’t match.'
    return
  }
  loading.value = true
  try {
    await props.submit(password.value)
  } catch (err) {
    error.value = authError(err, props.fallbackError).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form method="post" class="flex flex-col gap-6" novalidate @submit.prevent="onSubmit">
    <AuthNotice v-if="error" tone="error">{{ error }}</AuthNotice>
    <FieldGroup class="gap-5">
      <Field>
        <FieldLabel for="new-password" class="eyebrow">New password</FieldLabel>
        <AuthPasswordInput id="new-password" v-model="password" name="password" autocomplete="new-password" :minlength="MIN" required />
      </Field>
      <Field :data-invalid="mismatch || undefined">
        <FieldLabel for="confirm-password" class="eyebrow">Confirm password</FieldLabel>
        <AuthPasswordInput id="confirm-password" v-model="confirm" name="confirm-password" autocomplete="new-password" required :aria-invalid="mismatch" />
        <FieldError v-if="mismatch">The passwords don’t match.</FieldError>
      </Field>
    </FieldGroup>
    <AuthSubmitButton :loading="loading">{{ action }}</AuthSubmitButton>
  </form>
</template>
