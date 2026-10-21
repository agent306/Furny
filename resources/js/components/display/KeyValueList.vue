<script setup lang="ts">
import { PLACEHOLDER } from '@/lib/format';
import { cn } from '@/lib/utils';

// 15 §9.28. `label`/`value` are already translated. An item with `slot` renders
// that named slot as its value; one with neither shows an em dash.
withDefaults(
    defineProps<{
        items: { label: string; value?: string; slot?: string }[];
        columns?: 1 | 2;
    }>(),
    { columns: 1 },
);
</script>

<template>
    <dl
        :class="
            cn(
                'grid gap-x-6 gap-y-3 text-sm',
                columns === 2 && 'sm:grid-cols-2',
            )
        "
    >
        <div v-for="(item, index) in items" :key="index" class="min-w-0">
            <dt class="text-muted-foreground">{{ item.label }}</dt>
            <dd class="mt-0.5 font-medium break-words">
                <slot v-if="item.slot" :name="item.slot" />
                <template v-else>{{ item.value || PLACEHOLDER }}</template>
            </dd>
        </div>
    </dl>
</template>
