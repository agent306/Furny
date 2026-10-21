<script setup lang="ts">
import { computed, useId } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Input } from '@/components/ui/input';
import { useControlSize } from '@/composables/useControlSize';
import { useDecimalField } from '@/composables/useDecimalField';
import type { DecimalReading } from '@/composables/useDecimalField';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { inputAttrs, rootAttrs } from '@/lib/fieldAttrs';
import { parseMajorToMinor } from '@/lib/format';
import type { NumberSeparators } from '@/lib/format';

// 15 §9.23. The model is basis points (1% = 100). Text is read as a decimal
// with `decimals` places by lib/format's string parser, so `4.35` is exactly
// 435 and finer input than `decimals` is an error, not a rounding. A trailing
// `%` the user types is ignored. Typing emits at once; errors wait for blur or
// Enter. `min` defaults to 0, so a negative needs an explicit negative `min`.
//
// `modelValue` also accepts `null` (an empty field), which the spec's `number`
// does not; the field emits `null` for empty or unreadable text.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
    defineProps<{
        /** Basis points. */
        modelValue: number | null;
        /** Basis points. Default 0. */
        min?: number;
        /** Basis points. */
        max?: number;
        decimals?: 0 | 1 | 2;
        invalid?: boolean;
    }>(),
    { min: 0, max: undefined, decimals: 2 },
);

const emit = defineEmits<{
    'update:modelValue': [bps: number | null];
}>();

const { t } = useI18n();
const size = useControlSize();
const { formatBps } = useFormat();
const errorId = useId();

// bps per unit of the last shown place: 1 (2 decimals), 10 or 100.
const unit = computed(() => 10 ** (2 - props.decimals));

/**
 * `1250` → `12.50` at 2 decimals (the locale's decimal separator); rounds half
 * up when the value is finer than `decimals`.
 */
function display(bps: number | null, { decimal }: NumberSeparators): string {
    if (bps === null) {
        return '';
    }

    const scaled = Math.round(Math.abs(bps) / unit.value);
    const padded = String(scaled).padStart(props.decimals + 1, '0');
    const whole =
        props.decimals === 0 ? padded : padded.slice(0, -props.decimals);
    const fraction =
        props.decimals === 0
            ? ''
            : `${decimal}${padded.slice(-props.decimals)}`;

    return `${bps < 0 && scaled !== 0 ? '-' : ''}${whole}${fraction}`;
}

function rangeError(bps: number): string | null {
    const { min, max } = props;
    const lower = bps < min;
    const upper = max !== undefined && bps > max;

    if (!lower && !upper) {
        return null;
    }

    const params = {
        min: formatBps(min),
        max: max === undefined ? '' : formatBps(max),
    };

    if (max !== undefined) {
        return t('money.errors.out_of_range', params);
    }

    return t('money.errors.too_small', params);
}

function read(value: string, separators: NumberSeparators): DecimalReading {
    const cleaned = value.replace(/\s*%\s*$/, '').trim();

    if (cleaned === '') {
        return { value: null, error: null };
    }

    const scaled = parseMajorToMinor(cleaned, props.decimals, separators);
    const bps = scaled === null ? null : scaled * unit.value;

    if (bps === null || !Number.isSafeInteger(bps)) {
        return { value: null, error: t('money.errors.invalid_percent') };
    }

    const outOfRange = rangeError(bps);

    return outOfRange === null
        ? { value: bps, error: null }
        : { value: null, error: outOfRange };
}

const { text, error, onInput, onFocus, onBlur, onEnter } = useDecimalField({
    model: () => props.modelValue,
    read,
    show: display,
    emit: (bps) => emit('update:modelValue', bps),
});

const message = computed(() => error.value ?? undefined);
</script>

<template>
    <div v-bind="rootAttrs($attrs)">
        <div class="relative">
            <Input
                v-bind="inputAttrs($attrs, message ? errorId : undefined)"
                :model-value="text"
                :size="size"
                type="text"
                :inputmode="min < 0 ? 'text' : 'decimal'"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="invalid || message ? 'true' : undefined"
                class="pe-8 tabular-nums"
                @update:model-value="onInput"
                @focus="onFocus"
                @blur="onBlur"
                @keydown.enter="onEnter"
            />
            <span
                data-testid="percent-suffix"
                class="pointer-events-none absolute inset-y-0 end-3 flex items-center font-mono text-sm text-muted-foreground"
                >%</span
            >
        </div>
        <InputError :id="errorId" :message="message" />
    </div>
</template>
