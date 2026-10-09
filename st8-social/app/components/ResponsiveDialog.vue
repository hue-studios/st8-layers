<script setup lang="ts">
// A dialog on desktop and a bottom drawer on phones, with one API. Used by the social layer (report, reactors,
// moderation) and free for the host to reuse.
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'

const open = defineModel<boolean>('open', { default: false })
withDefaults(defineProps<{ title: string, description?: string, contentClass?: string, hideHeader?: boolean }>(), {
  description: undefined,
  contentClass: undefined,
  hideHeader: false,
})
const desktop = useSocialDesktop()
</script>

<template>
  <Dialog v-if="desktop" v-model:open="open">
    <DialogContent :class="cn('max-h-[85dvh] gap-0 overflow-hidden rounded-panel p-0 sm:max-w-md', contentClass)">
      <DialogHeader :class="cn('border-b border-glass-border px-6 pt-5 pb-4 text-left', hideHeader && 'sr-only')">
        <DialogTitle class="eyebrow">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="text-xs">{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto px-6 py-4">
        <slot />
      </div>
      <DialogFooter v-if="$slots.footer" class="border-t border-glass-border px-6 py-3">
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Drawer v-else v-model:open="open">
    <DrawerContent :class="cn('max-h-[88dvh] pb-[env(safe-area-inset-bottom)]', contentClass)">
      <DrawerHeader :class="cn('px-5 pt-3 pb-2 text-left', hideHeader && 'sr-only')">
        <DrawerTitle class="eyebrow">{{ title }}</DrawerTitle>
        <DrawerDescription v-if="description" class="text-xs">{{ description }}</DrawerDescription>
      </DrawerHeader>
      <div class="min-h-0 overflow-y-auto px-5 pb-4">
        <slot />
      </div>
      <DrawerFooter v-if="$slots.footer" class="border-t border-glass-border px-5 py-3">
        <slot name="footer" />
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
</template>
