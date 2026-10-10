<script setup lang="ts">
// A member's avatar in the social components, ringed in their accent colour (Insider: their industry).
import type { SocialPerson } from '../../../shared/types/social'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'

const props = withDefaults(defineProps<{ person: Pick<SocialPerson, 'name' | 'avatar' | 'color'> | null, size?: 'xs' | 'sm' | 'md' }>(), { size: 'sm' })
const PX = { xs: 20, sm: 32, md: 40 } as const
// The photo comes from wherever the host serves avatars (st8-auth's public.st8Auth.avatarUrl; the Member avatars folder
// isn't public).
const avatarUrl = useAvatarUrl()
const src = computed(() => (props.person?.avatar ? avatarUrl(props.person.avatar, PX[props.size] * 2) : undefined))
</script>

<template>
  <Avatar
    :class="cn('shrink-0 bg-muted', { xs: 'size-5', sm: 'size-8', md: 'size-10' }[size], person?.color && (size === 'md' ? 'border-[3px]' : 'border-2'))"
    :style="person?.color ? { borderColor: person.color } : undefined"
  >
    <AvatarImage v-if="src" :src="src" :alt="person?.name ?? ''" class="object-cover" />
    <AvatarFallback :class="cn('font-bold', size === 'xs' ? 'text-[8px]' : 'text-[10px]')">
      <Icon v-if="!person" name="lucide:user-round" class="size-3/5 text-muted-foreground" />
      <template v-else>{{ personInitials(person.name) }}</template>
    </AvatarFallback>
  </Avatar>
</template>
