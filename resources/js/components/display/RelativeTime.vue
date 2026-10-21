<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useFormat } from '@/composables/useFormat';
import { PLACEHOLDER } from '@/lib/format';

// 15 §9.28: relative text, absolute time (user zone) as the tooltip, refreshed
// every minute.
const props = defineProps<{
    /** ISO-8601 instant. */
    at: string;
}>();

const { formatRelative, formatDateTime } = useFormat();

const now = ref(Date.now());

useIntervalFn(() => {
    now.value = Date.now();
}, 60_000);

const relative = computed(() => formatRelative(props.at, now.value));
const readable = computed(() => relative.value !== PLACEHOLDER);
</script>

<template>
    <time
        :datetime="readable ? at : undefined"
        :title="readable ? formatDateTime(at, 'long') : undefined"
        >{{ relative }}</time
    >
</template>
