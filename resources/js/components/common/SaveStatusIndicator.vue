<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { IconName } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { SaveStatus } from '@/types/ui';

// 15 §9.31: the editor top bar's autosave state. A polite live region; a
// button when `onClick` is given (the plan editor opens its Checks popover for
// `invalid`).
const props = defineProps<{
    status: SaveStatus;
    /** ISO instant of the last save, for "Saved · 2 min ago". */
    savedAt?: string;
    /** Problem count of the `invalid` status. */
    count?: number;
    onClick?: () => void;
}>();

const { t } = useI18n();
const { formatRelative } = useFormat();
// Re-read every 30 s so "2 min ago" does not go stale while the editor idles.
const now = ref(Date.now());

useIntervalFn(() => {
    now.value = Date.now();
}, 30_000);

const ICON: Record<SaveStatus, IconName> = {
    saved: 'check',
    saving: 'loader-circle',
    dirty: 'file-pen',
    offline: 'wifi-off',
    error: 'alert-triangle',
    conflict: 'git-compare',
    invalid: 'alert-triangle',
};

const label = computed(() => {
    switch (props.status) {
        case 'saved':
            return props.savedAt
                ? t('common.save_status.saved_ago', {
                      time: formatRelative(props.savedAt, now.value),
                  })
                : t('common.save_status.saved');
        case 'invalid':
            return t('common.save_status.invalid', { count: props.count ?? 0 });
        default:
            return t(`common.save_status.${props.status}`);
    }
});

const destructive = computed(() =>
    ['invalid', 'error', 'conflict'].includes(props.status),
);
</script>

<template>
    <component
        :is="onClick ? 'button' : 'span'"
        :type="onClick ? 'button' : undefined"
        :role="onClick ? undefined : 'status'"
        :aria-live="onClick ? undefined : 'polite'"
        :data-status="status"
        :class="
            cn(
                'inline-flex min-h-6 items-center gap-1.5 rounded-md px-2 text-xs',
                destructive
                    ? 'bg-danger-subtle text-danger-subtle-foreground'
                    : 'text-muted-foreground',
                onClick &&
                    'min-h-11 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:min-h-8',
            )
        "
        @click="onClick?.()"
    >
        <component
            :is="ICONS[ICON[status]]"
            :class="cn('size-3.5', status === 'saving' && 'animate-spin')"
            aria-hidden="true"
        />
        <span>{{ label }}</span>
    </component>
</template>
