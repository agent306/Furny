<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Input } from '@/components/ui/input';
import { useControlSize } from '@/composables/useControlSize';
import { useFormat, useFormatContext } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { inputAttrs, rootAttrs } from '@/lib/fieldAttrs';
import { currencyFractionDigits, parseMajorToMinor } from '@/lib/format';

// 15 §9.22. The model is integer minor units. Text is parsed with lib/format's
// `parseMajorToMinor` (string and BigInt arithmetic: no float rounding, and
// more fraction digits than the currency has is an error, not a rounding), so
// 0-, 2- and 3-decimal currencies all work. That parser owns the accepted
// grammar: `.` decimals and `,` grouping (western or lakh).
//
// While typing, every parseable value is emitted at once (a Save button never
// waits for blur) and an unparseable one emits `null`, but errors appear only
// on blur or Enter. Outside changes to `modelValue` re-format the text unless
// the field has focus.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
    defineProps<{
        /** Integer minor units. */
        modelValue: number | null;
        /** ISO-4217; defaults to `business.currency`. */
        currency?: string;
        /** Minor units. */
        min?: number;
        /** Minor units. */
        max?: number;
        allowNegative?: boolean;
        placeholder?: string;
        invalid?: boolean;
    }>(),
    {
        currency: undefined,
        min: undefined,
        max: undefined,
        placeholder: undefined,
    },
);

const emit = defineEmits<{
    'update:modelValue': [minor: number | null];
}>();

const { t } = useI18n();
const size = useControlSize();
const context = useFormatContext();
const { currencySymbol, formatMoney, formatMoneyAmount, minorToMajorString } =
    useFormat();
const errorId = useId();

const code = computed(() => props.currency ?? context().currency);
const digits = computed(() => currencyFractionDigits(code.value));
const symbol = computed(() => currencySymbol(code.value));

function display(minor: number | null): string {
    return minor === null ? '' : formatMoneyAmount(minor, code.value);
}

const text = ref(display(props.modelValue));
const focused = ref(false);
const error = ref<string | null>(null);

type Evaluation = { minor: number | null; error: string | null };

function rangeError(minor: number): string | null {
    const { min, max } = props;

    if (min === undefined && max === undefined) {
        return null;
    }

    const lower = min !== undefined && minor < min;
    const upper = max !== undefined && minor > max;

    if (!lower && !upper) {
        return null;
    }

    const params = {
        min: min === undefined ? '' : formatMoney(min, code.value),
        max: max === undefined ? '' : formatMoney(max, code.value),
    };

    if (min !== undefined && max !== undefined) {
        return t('money.errors.out_of_range', params);
    }

    return t(
        lower ? 'money.errors.too_small' : 'money.errors.too_large',
        params,
    );
}

function evaluate(value: string): Evaluation {
    if (value.trim() === '') {
        return { minor: null, error: null };
    }

    const minor = parseMajorToMinor(value, digits.value);

    if (minor === null || (minor < 0 && !props.allowNegative)) {
        return { minor: null, error: t('money.errors.invalid') };
    }

    const outOfRange = rangeError(minor);

    return outOfRange === null
        ? { minor, error: null }
        : { minor: null, error: outOfRange };
}

function onInput(value: string | number): void {
    text.value = String(value);

    const result = evaluate(text.value);

    // An error is only ever *cleared* mid-edit; it is raised on blur / Enter.
    if (result.error === null) {
        error.value = null;
    }

    if (result.minor !== props.modelValue) {
        emit('update:modelValue', result.minor);
    }
}

function finish(): void {
    const result = evaluate(text.value);

    error.value = result.error;
    emit('update:modelValue', result.minor);

    if (result.error === null) {
        text.value = display(result.minor);
    }
}

function onFocus(event: FocusEvent): void {
    focused.value = true;

    const input = event.target as HTMLInputElement;

    // Edit without grouping separators: `12345.67`, not `12,345.67`.
    if (error.value === null && props.modelValue !== null) {
        text.value = minorToMajorString(props.modelValue, code.value);
    }

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

// A currency change re-draws the same amount in the new currency's shape.
watch(code, () => {
    if (!focused.value) {
        text.value = display(props.modelValue);
    }
});

const message = computed(() => error.value ?? undefined);
</script>

<template>
    <div v-bind="rootAttrs($attrs)">
        <div class="relative">
            <span
                data-testid="currency-symbol"
                class="pointer-events-none absolute inset-y-0 start-3 flex items-center font-mono text-sm text-muted-foreground"
                >{{ symbol }}</span
            >
            <Input
                v-bind="inputAttrs($attrs, message ? errorId : undefined)"
                :model-value="text"
                :size="size"
                type="text"
                :inputmode="allowNegative ? 'text' : 'decimal'"
                autocomplete="off"
                spellcheck="false"
                :placeholder="placeholder"
                :aria-invalid="invalid || message ? 'true' : undefined"
                class="tabular-nums"
                :style="{
                    paddingInlineStart: `calc(1.5rem + ${symbol.length}ch)`,
                }"
                @update:model-value="onInput"
                @focus="onFocus"
                @blur="onBlur"
                @keydown.enter="finish"
            />
        </div>
        <InputError :id="errorId" :message="message" />
    </div>
</template>
