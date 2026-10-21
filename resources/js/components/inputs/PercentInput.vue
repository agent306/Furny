<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Input } from '@/components/ui/input';
import { useControlSize } from '@/composables/useControlSize';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { inputAttrs, rootAttrs } from '@/lib/fieldAttrs';
import { parseMajorToMinor } from '@/lib/format';

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

/** `1250` → `12.50` at 2 decimals; rounds half up when the value is finer. */
function display(bps: number | null): string {
    if (bps === null) {
        return '';
    }

    const scaled = Math.round(Math.abs(bps) / unit.value);
    const padded = String(scaled).padStart(props.decimals + 1, '0');
    const whole =
        props.decimals === 0 ? padded : padded.slice(0, -props.decimals);
    const fraction =
        props.decimals === 0 ? '' : `.${padded.slice(-props.decimals)}`;

    return `${bps < 0 && scaled !== 0 ? '-' : ''}${whole}${fraction}`;
}

const text = ref(display(props.modelValue));
const focused = ref(false);
const error = ref<string | null>(null);

type Evaluation = { bps: number | null; error: string | null };

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

function evaluate(value: string): Evaluation {
    const cleaned = value.replace(/%\s*$/, '').trim();

    if (cleaned === '') {
        return { bps: null, error: null };
    }

    const scaled = parseMajorToMinor(cleaned, props.decimals);
    const bps = scaled === null ? null : scaled * unit.value;

    if (bps === null || !Number.isSafeInteger(bps)) {
        return { bps: null, error: t('money.errors.invalid_percent') };
    }

    const outOfRange = rangeError(bps);

    return outOfRange === null
        ? { bps, error: null }
        : { bps: null, error: outOfRange };
}

function onInput(value: string | number): void {
    text.value = String(value);

    const result = evaluate(text.value);

    if (result.error === null) {
        error.value = null;
    }

    if (result.bps !== props.modelValue) {
        emit('update:modelValue', result.bps);
    }
}

function finish(): void {
    const result = evaluate(text.value);

    error.value = result.error;
    emit('update:modelValue', result.bps);

    if (result.error === null) {
        text.value = display(result.bps);
    }
}

function onFocus(event: FocusEvent): void {
    focused.value = true;

    const input = event.target as HTMLInputElement;

    void nextTick(() => input.select());
}

function onBlur(): void {
    focused.value = false;
    finish();
}

watch(
    () => props.modelValue,
    (value) => {
        if (!focused.value) {
            text.value = display(value);
            error.value = null;
        }
    },
);

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
                @keydown.enter="finish"
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
