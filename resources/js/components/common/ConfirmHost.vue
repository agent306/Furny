<script setup lang="ts">
import { computed } from 'vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import { useConfirmHost } from '@/composables/useConfirm';

// The single global dialog behind `useConfirm().confirm()` (15 §9.20). AppShell
// mounts it once. While mounted it is the host: `confirm()` calls queue and are
// answered one by one; when the last host unmounts, pending calls answer false.
const host = useConfirmHost();

const options = computed(() => host.options.value ?? { title: '' });

function onUpdateOpen(open: boolean): void {
    if (!open) {
        host.settle(host.id.value, false);
    }
}
</script>

<template>
    <!-- Keyed by call so a queued dialog never inherits typed text or ticks. -->
    <ConfirmDialog
        :key="host.id.value"
        v-bind="options"
        :open="host.open.value"
        @confirm="host.settle(host.id.value, true)"
        @update:open="onUpdateOpen"
    />
</template>
