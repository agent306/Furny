<script setup lang="ts">
import { computed } from 'vue';
import { useFormat } from '@/composables/useFormat';
import type { DateStyle } from '@/lib/format';

// 15 §9.28. A date-only value (`2026-10-20`) is a calendar date and is printed
// as is, in no time zone; an instant is shown in the user's zone.
const props = withDefaults(
    defineProps<{
        value: string;
        kind: 'date' | 'datetime' | 'time';
        style?: DateStyle;
    }>(),
    { style: 'medium' },
);

const { formatDate, formatDateTime, formatTime } = useFormat();

const text = computed(() => {
    switch (props.kind) {
        case 'date':
            return formatDate(props.value, props.style);
        case 'datetime':
            return formatDateTime(props.value, props.style);
        default:
            return formatTime(props.value, props.style);
    }
});
</script>

<template>
    <time :datetime="text === '—' ? undefined : value">{{ text }}</time>
</template>
