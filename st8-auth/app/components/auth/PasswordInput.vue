<script setup lang="ts">
// Password field with a show/hide toggle, composed from the base Input and Button.
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ default: '' })
const visible = ref(false)
</script>

<template>
  <div class="relative">
    <Input v-bind="$attrs" v-model="model" :type="visible ? 'text' : 'password'" class="rounded-full pr-11 pl-4" />
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-full text-muted-foreground"
      :aria-label="visible ? 'Hide password' : 'Show password'"
      :aria-pressed="visible"
      @click="visible = !visible"
    >
      <Icon :name="visible ? 'lucide:eye-off' : 'lucide:eye'" class="size-4" />
    </Button>
  </div>
</template>
