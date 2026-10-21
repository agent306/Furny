<script setup lang="ts">
import { useOnline } from '@vueuse/core';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';

// 15 §9.31: shown while the browser reports no connection.
const { t } = useI18n();
const online = useOnline();
</script>

<template>
    <div
        v-if="!online"
        role="status"
        data-test="offline-banner"
        class="flex items-center justify-center gap-2 bg-warning-subtle px-4 py-2 text-center text-sm text-warning-subtle-foreground"
    >
        <component
            :is="ICONS['wifi-off']"
            class="size-4 shrink-0"
            aria-hidden="true"
        />
        <span>{{ t('common.offline.banner') }}</span>
    </div>
</template>
