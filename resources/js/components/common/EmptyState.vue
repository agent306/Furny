<script setup lang="ts">
import { computed, useSlots } from 'vue';
import GrainMotif from '@/components/common/GrainMotif.vue';
import { ICONS } from '@/lib/icons';
import type { IconName } from '@/lib/icons';
import { cn } from '@/lib/utils';

// 15 §9.19, §13. `title`/`description` are already translated.
const props = withDefaults(
    defineProps<{
        icon: IconName;
        title: string;
        description?: string;
        size?: 'sm' | 'md' | 'lg';
        /** Defaults to `grain` for `lg`, `none` otherwise. */
        illustration?: 'grain' | 'none';
    }>(),
    { description: undefined, size: 'md', illustration: undefined },
);

const slots = useSlots();

const withGrain = computed(
    () =>
        (props.illustration ?? (props.size === 'lg' ? 'grain' : 'none')) ===
        'grain',
);
const CIRCLE_CLASS = {
    sm: 'size-12 [&>svg]:size-5',
    md: 'size-16 [&>svg]:size-7',
    lg: 'size-24 [&>svg]:size-10',
} as const;
const PADDING_CLASS = { sm: 'py-6', md: 'py-10', lg: 'py-16' } as const;
</script>

<template>
    <div
        :class="
            cn(
                'flex flex-col items-center gap-3 px-4 text-center',
                PADDING_CLASS[size],
            )
        "
    >
        <div class="relative flex items-center justify-center">
            <GrainMotif
                v-if="withGrain"
                class="absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
            />
            <div
                :class="
                    cn(
                        'relative flex items-center justify-center rounded-full bg-brand-wood-subtle text-brand-wood',
                        CIRCLE_CLASS[size],
                    )
                "
            >
                <component :is="ICONS[icon]" aria-hidden="true" />
            </div>
        </div>
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <p
            v-if="description"
            class="max-w-sm text-center text-muted-foreground"
        >
            {{ description }}
        </p>
        <div
            v-if="slots.actions"
            data-slot="empty-state-actions"
            class="mt-2 flex flex-wrap items-center justify-center gap-2"
        >
            <slot name="actions" />
        </div>
    </div>
</template>
