<script setup lang="ts">
import { computed } from 'vue';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/composables/useInitials';
import { cn } from '@/lib/utils';

// 15 §9.28. The whole avatar is one image named after the person; the
// initials and the photo are presentational inside it.
const props = withDefaults(
    defineProps<{
        user: { name: string; avatarUrl: string | null };
        size?: 'xs' | 'sm' | 'md' | 'lg';
    }>(),
    { size: 'md' },
);

const SIZE_CLASS = {
    xs: 'size-6 text-[10px]',
    sm: 'size-8 text-xs',
    md: 'size-10 text-sm',
    lg: 'size-14 text-base',
} as const;

const initials = computed(() => getInitials(props.user.name));
</script>

<template>
    <Avatar role="img" :aria-label="user.name" :class="cn(SIZE_CLASS[size])">
        <AvatarImage v-if="user.avatarUrl" :src="user.avatarUrl" alt="" />
        <AvatarFallback
            aria-hidden="true"
            class="bg-brand-wood-subtle font-medium text-foreground"
            >{{ initials }}</AvatarFallback
        >
    </Avatar>
</template>
