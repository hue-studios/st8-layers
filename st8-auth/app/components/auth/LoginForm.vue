<script setup lang="ts">
import { Field, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'

const props = defineProps<{ initialEmail?: string }>()
const { login } = useAuth()

const email = ref(props.initialEmail ?? '')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await login(email.value, password.value)
  } catch (err) {
    error.value = authError(err, 'Sign-in failed. Please try again.').message
    password.value = ''
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form method="post" class="flex flex-col gap-6" novalidate @submit.prevent="submit">
    <AuthNotice v-if="error" tone="error">{{ error }}</AuthNotice>
    <FieldGroup class="gap-5">
      <Field>
        <FieldLabel for="login-email" class="eyebrow">Email</FieldLabel>
        <Input id="login-email" v-model="email" type="email" name="email" autocomplete="email" inputmode="email" required class="rounded-full px-4" :aria-invalid="!!error" />
      </Field>
      <Field>
        <div class="flex items-center justify-between">
          <FieldLabel for="login-password" class="eyebrow">Password</FieldLabel>
          <NuxtLink :to="{ path: '/auth/forgot-password', query: email ? { email } : {} }" class="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </NuxtLink>
        </div>
        <AuthPasswordInput id="login-password" v-model="password" name="password" autocomplete="current-password" required :aria-invalid="!!error" />
      </Field>
    </FieldGroup>
    <AuthSubmitButton :loading="loading">Sign in</AuthSubmitButton>
  </form>
</template>
