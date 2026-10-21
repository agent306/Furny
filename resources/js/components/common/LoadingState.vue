<script setup lang="ts">
import { computed } from 'vue';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/composables/useI18n';

// 15 §9.31: skeleton presets, used as the `<Deferred>` fallback.
const props = withDefaults(
    defineProps<{
        variant: 'list' | 'cards' | 'detail' | 'table';
        rows?: number;
    }>(),
    { rows: 3 },
);

const { t } = useI18n();
const count = computed(() => Math.max(1, Math.floor(props.rows)));
</script>

<template>
    <div role="status" aria-busy="true" :data-variant="variant" class="w-full">
        <span class="sr-only">{{ t('common.loading') }}</span>

        <div v-if="variant === 'list'" class="space-y-3" aria-hidden="true">
            <div
                v-for="row in count"
                :key="row"
                data-row
                class="flex items-center gap-3"
            >
                <Skeleton class="size-10 shrink-0 rounded-full" />
                <div class="flex-1 space-y-2">
                    <Skeleton class="h-4 w-1/3" />
                    <Skeleton class="h-3 w-2/3" />
                </div>
            </div>
        </div>

        <div
            v-else-if="variant === 'cards'"
            class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-hidden="true"
        >
            <div
                v-for="row in count"
                :key="row"
                data-row
                class="space-y-3 rounded-xl border p-4"
            >
                <Skeleton class="h-32 w-full" />
                <Skeleton class="h-4 w-2/3" />
                <Skeleton class="h-3 w-1/2" />
            </div>
        </div>

        <div
            v-else-if="variant === 'detail'"
            class="space-y-4"
            aria-hidden="true"
        >
            <Skeleton class="h-8 w-1/3" />
            <Skeleton class="h-4 w-1/2" />
            <div v-for="row in count" :key="row" data-row class="space-y-2">
                <Skeleton class="h-4 w-full" />
                <Skeleton class="h-4 w-5/6" />
            </div>
        </div>

        <div v-else class="space-y-2" aria-hidden="true">
            <Skeleton class="h-9 w-full" />
            <Skeleton
                v-for="row in count"
                :key="row"
                data-row
                class="h-12 w-full"
            />
        </div>
    </div>
</template>
