<script setup lang="ts">
import { computed, useId, watch } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Input } from '@/components/ui/input';
import { useControlSize } from '@/composables/useControlSize';
import { useDecimalField } from '@/composables/useDecimalField';
import { useFormat, useFormatContext } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { inputAttrs, rootAttrs } from '@/lib/fieldAttrs';
import {
    currencyFractionDigits,
    parseMajorToMinor,
    stripCurrencyTokens,
} from '@/lib/format';
import type { NumberSeparators } from '@/lib/format';

// 15 §9.22. The model is integer minor units. Text is parsed with lib/format's
// `parseMajorToMinor` (string and BigInt arithmetic: no float rounding, and
// more fraction digits than the currency has is an error, not a rounding), so
// 0-, 2- and 3-decimal currencies all work. That parser owns the accepted
// grammar (western or lakh grouping), in the business locale's decimal and
// group separators (`1.234,56` in de-DE, `1 234,56` in fr-FR; the other
// locale's spelling is an error). A pasted currency symbol or ISO code
// (`₹ 12,345.67`, `INR 12,345.67`) is stripped first.
//
// The typing lifecycle (live emit, errors on blur or Enter, no re-draw while
// focused, Enter leaves the text alone) is `useDecimalField`.
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
const {
    currencySymbol,
    currencyTokens,
    formatMoney,
    formatMoneyAmount,
    minorToMajorString,
} = useFormat();
const errorId = useId();

const code = computed(() => props.currency ?? context().currency);
const digits = computed(() => currencyFractionDigits(code.value));
const symbol = computed(() => currencySymbol(code.value));

type Reading = { value: number | null; error: string | null };

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

// Pasted text may carry the currency: `₹ 12,345.67`, `INR 12,345.67`.
function read(value: string, separators: NumberSeparators): Reading {
    const bare = stripCurrencyTokens(value, currencyTokens(code.value));

    if (bare.trim() === '') {
        return { value: null, error: null };
    }

    const minor = parseMajorToMinor(bare, digits.value, separators);

    if (minor === null || (minor < 0 && !props.allowNegative)) {
        return { value: null, error: t('money.errors.invalid') };
    }

    const outOfRange = rangeError(minor);

    return outOfRange === null
        ? { value: minor, error: null }
        : { value: null, error: outOfRange };
}

const { text, error, onInput, onFocus, onBlur, onEnter, refresh } =
    useDecimalField({
        model: () => props.modelValue,
        read,
        show: (minor) =>
            minor === null ? '' : formatMoneyAmount(minor, code.value),
        edit: (minor, { decimal }) =>
            minorToMajorString(minor, code.value).replace('.', decimal),
        emit: (minor) => emit('update:modelValue', minor),
    });

// A currency change re-draws the same amount in the new currency's shape.
watch(code, refresh);

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
                @keydown.enter="onEnter"
            />
        </div>
        <InputError :id="errorId" :message="message" />
    </div>
</template>
