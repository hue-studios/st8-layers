<script setup lang="ts">
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'

const { register } = useAuth()

const form = reactive({ first_name: '', last_name: '', email: '', password: '' })
const loading = ref(false)
const error = ref('')
const MIN = 8

async function submit() {
  error.value = ''
  if (form.password.length < MIN) {
    error.value = `Your password must be at least ${MIN} characters.`
    return
  }
  loading.value = true
  try {
    await register({ ...form, email: form.email.trim().toLowerCase() })
  } catch (err) {
    error.value = authError(err, 'We couldn’t create your account. Please try again.').message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form method="post" class="flex flex-col gap-6" novalidate @submit.prevent="submit">
    <AuthNotice v-if="error" tone="error">{{ error }}</AuthNotice>
    <FieldGroup class="gap-5">
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel for="register-first" class="eyebrow">First name</FieldLabel>
          <Input id="register-first" v-model="form.first_name" name="given-name" autocomplete="given-name" required class="rounded-full px-4" />
        </Field>
        <Field>
          <FieldLabel for="register-last" class="eyebrow">Last name</FieldLabel>
          <Input id="register-last" v-model="form.last_name" name="family-name" autocomplete="family-name" required class="rounded-full px-4" />
        </Field>
      </div>
      <Field>
        <FieldLabel for="register-email" class="eyebrow">Email</FieldLabel>
        <Input id="register-email" v-model="form.email" type="email" name="email" autocomplete="email" inputmode="email" required class="rounded-full px-4" />
      </Field>
      <Field>
        <FieldLabel for="register-password" class="eyebrow">Password</FieldLabel>
        <AuthPasswordInput id="register-password" v-model="form.password" name="password" autocomplete="new-password" :minlength="MIN" required aria-describedby="register-password-hint" />
        <FieldDescription id="register-password-hint" class="text-xs">
          At least {{ MIN }} characters. Already have a Southern Tier 8 account? Use that email and its current password.
        </FieldDescription>
      </Field>
    </FieldGroup>
    <AuthSubmitButton :loading="loading">Create account</AuthSubmitButton>
  </form>
</template>
