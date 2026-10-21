<script setup lang="ts">
import { computed } from 'vue';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { cn } from '@/lib/utils';

// 15 §9.6. Minor units in; the only division is Intl's own, on an exact
// decimal string (lib/format), so no float maths on money.
const props = withDefaults(
    defineProps<{
        minor: number | null;
        /** Defaults to `business.currency`. */
        currency?: string;
        size?: 'sm' | 'md' | 'lg' | 'xl';
        signDisplay?: 'auto' | 'always' | 'exceptZero';
        muted?: boolean;
        strike?: boolean;
        /** Prefixes "≈" and names it "approximately" for screen readers. */
        approx?: boolean;
    }>(),
    { currency: undefined, size: 'md', signDisplay: undefined },
);

const { t } = useI18n();
const { formatMoney } = useFormat();

const APPROX = '≈';
const SIZE_CLASS = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg font-semibold',
    xl: 'text-2xl font-semibold',
} as const;

const text = computed(() =>
    props.minor === null
        ? null
        : formatMoney(props.minor, props.currency, {
              signDisplay: props.signDisplay,
          }),
);
</script>

<template>
    <span
        :class="
            cn(
                'tabular-nums',
                SIZE_CLASS[size],
                muted && 'text-muted-foreground',
                strike && 'line-through',
            )
        "
    >
        <template v-if="text === null">—</template>
        <template v-else>
            <span
                v-if="approx"
                role="img"
                :aria-label="t('money.approximately')"
                >{{ APPROX }}</span
            >{{ text }}
        </template>
    </span>
</template>
