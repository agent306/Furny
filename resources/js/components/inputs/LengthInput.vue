<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Input } from '@/components/ui/input';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { useLengthUnit } from '@/composables/useLengthUnit';
import { inputAttrs, rootAttrs } from '@/lib/fieldAttrs';
import { formatLengthValue, parseLengthInput } from '@/lib/lengthAdapter';
import type { LengthUnitKey } from '@/lib/lengthAdapter';

// 15 §9.7. The model is integer millimetres; the field shows them in `unit`.
// Parsing and formatting go through lib/lengthAdapter, a metric-only P1
// placeholder for the engine's `parseLength`/`formatLength` (P4 swaps the
// adapter body, not this component). Until then `ftin`/`in` fields show and
// accept millimetres, and typed feet-and-inches get a "not supported yet"
// message instead of "invalid".
//
// Nothing is emitted while typing: Enter or blur parses, checks the range and
// emits `update:modelValue` (+ `commit` for a number); out-of-range text is
// kept with `aria-invalid`. ArrowUp/Down, PageUp/Down step the value and emit
// at once, clamped to `min`/`max`. A floor of 0 applies unless `min` is
// negative. Stepping from an empty field starts at 0.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
    defineProps<{
        /** Integer millimetres. */
        modelValue: number | null;
        /** Display unit and the unit of bare numbers; default: the user's. */
        unit?: LengthUnitKey;
        /** Millimetres. */
        min?: number;
        /** Millimetres. */
        max?: number;
        /** Millimetres; default 10. */
        step?: number;
        required?: boolean;
        disabled?: boolean;
        id?: string;
        ariaLabel?: string;
        invalid?: boolean;
        placeholder?: string;
    }>(),
    {
        unit: undefined,
        min: undefined,
        max: undefined,
        step: 10,
        id: undefined,
        ariaLabel: undefined,
        placeholder: undefined,
    },
);

const emit = defineEmits<{
    'update:modelValue': [mm: number | null];
    commit: [mm: number];
}>();

const { t } = useI18n();
const size = useControlSize();
const userUnit = useLengthUnit();
const errorId = useId();

// P1: the adapter is metric only, so imperial fields work in millimetres.
const unit = computed<'mm' | 'cm' | 'm'>(() => {
    const wanted = props.unit ?? userUnit.value;

    return wanted === 'cm' || wanted === 'm' ? wanted : 'mm';
});
const floor = computed(() => props.min ?? 0);

function display(mm: number | null): string {
    return mm === null
        ? ''
        : formatLengthValue(mm, { system: 'metric', unit: unit.value });
}

function withUnit(mm: number): string {
    return `${display(mm)} ${unit.value}`;
}

const text = ref(display(props.modelValue));
const lastValid = ref<number | null>(props.modelValue);
const focused = ref(false);
const error = ref<string | null>(null);

type Outcome =
    | { kind: 'empty' }
    | { kind: 'value'; mm: number }
    | { kind: 'error'; message: string };

function rangeError(mm: number): string | null {
    const lower = mm < floor.value;
    const upper = props.max !== undefined && mm > props.max;

    if (!lower && !upper) {
        return null;
    }

    const params = {
        min: withUnit(floor.value),
        max: props.max === undefined ? '' : withUnit(props.max),
    };

    if (props.min !== undefined && props.max !== undefined) {
        return t('units.errors.out_of_range', params);
    }

    return t(
        lower ? 'units.errors.too_small' : 'units.errors.too_large',
        params,
    );
}

// Text to millimetres, before any range check.
function read(value: string): Outcome {
    if (value.trim() === '') {
        return { kind: 'empty' };
    }

    const parsed = parseLengthInput(value, unit.value);

    if (!parsed.ok) {
        return {
            kind: 'error',
            message: t(
                parsed.reason === 'unsupported'
                    ? 'units.errors.unsupported'
                    : 'units.errors.invalid_length',
            ),
        };
    }

    return { kind: 'value', mm: parsed.mm };
}

function evaluate(value: string): Outcome {
    const outcome = read(value);

    if (outcome.kind !== 'value') {
        return outcome;
    }

    const outOfRange = rangeError(outcome.mm);

    return outOfRange === null
        ? outcome
        : { kind: 'error', message: outOfRange };
}

function commit(): void {
    const outcome = evaluate(text.value);

    if (outcome.kind === 'error') {
        error.value = outcome.message;

        return;
    }

    if (outcome.kind === 'empty') {
        if (props.required) {
            error.value = t('units.errors.invalid_length');

            return;
        }

        error.value = null;
        lastValid.value = null;
        text.value = '';
        emit('update:modelValue', null);

        return;
    }

    error.value = null;
    lastValid.value = outcome.mm;
    text.value = display(outcome.mm);
    emit('update:modelValue', outcome.mm);
    emit('commit', outcome.mm);
}

function revert(): void {
    error.value = null;
    text.value = display(lastValid.value);
}

function isDirty(): boolean {
    return error.value !== null || text.value !== display(lastValid.value);
}

// Whole millimetres, half away from zero (`roundMm`, 04 §0).
function roundMm(value: number): number {
    return Math.sign(value) * Math.round(Math.abs(value));
}

function stepBy(
    direction: 1 | -1,
    event: KeyboardEvent,
    tenfold: boolean,
): void {
    // Out-of-range text still counts: ArrowDown from a typed 7000 (max 6000)
    // lands on the clamped value.
    const typed = read(text.value);
    const base = typed.kind === 'value' ? typed.mm : (lastValid.value ?? 0);
    let amount = props.step;

    if (tenfold || event.shiftKey) {
        amount *= 10;
    } else if (event.altKey) {
        amount = Math.max(1, amount * 0.1);
    }

    let next = roundMm(base + direction * amount);

    next = Math.max(next, floor.value);

    if (props.max !== undefined) {
        next = Math.min(next, props.max);
    }

    const changed = next !== lastValid.value;

    error.value = null;
    lastValid.value = next;
    text.value = display(next);

    if (changed) {
        emit('update:modelValue', next);
    }
}

function onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
        case 'Enter':
            commit();
            break;
        case 'Escape':
            // Swallow it only when it undoes something, so an enclosing
            // dialog still closes on a second press.
            if (isDirty()) {
                event.stopPropagation();
                revert();
            }

            break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'PageUp':
        case 'PageDown':
            event.preventDefault();
            stepBy(
                event.key.endsWith('Up') ? 1 : -1,
                event,
                event.key.startsWith('Page'),
            );
            break;
        default:
    }
}

function onFocus(event: FocusEvent): void {
    focused.value = true;

    const input = event.target as HTMLInputElement;

    void nextTick(() => input.select());
}

function onBlur(): void {
    focused.value = false;
    commit();
}

watch(
    () => props.modelValue,
    (value) => {
        lastValid.value = value;

        if (!focused.value) {
            text.value = display(value);
            error.value = null;
        }
    },
);

// A new display unit re-draws the same millimetres.
watch(unit, () => {
    if (!focused.value) {
        text.value = display(lastValid.value);
        error.value = null;
    }
});

const message = computed(() => error.value ?? undefined);
const valueText = computed(() =>
    lastValid.value === null ? undefined : withUnit(lastValid.value),
);
</script>

<template>
    <div v-bind="rootAttrs($attrs)">
        <div class="relative">
            <Input
                v-bind="inputAttrs($attrs, message ? errorId : undefined)"
                :id="id"
                :model-value="text"
                :size="size"
                type="text"
                role="spinbutton"
                :disabled="disabled"
                :aria-label="ariaLabel"
                inputmode="text"
                autocomplete="off"
                spellcheck="false"
                :placeholder="placeholder"
                :aria-valuenow="lastValid ?? undefined"
                :aria-valuetext="valueText"
                :aria-valuemin="floor"
                :aria-valuemax="max"
                :aria-required="required ? 'true' : undefined"
                :aria-invalid="invalid || message ? 'true' : undefined"
                class="pe-12 font-mono"
                @update:model-value="text = String($event)"
                @keydown="onKeydown"
                @focus="onFocus"
                @blur="onBlur"
            />
            <span
                data-testid="length-unit"
                class="pointer-events-none absolute inset-y-0 end-3 flex items-center font-mono text-sm text-muted-foreground"
                >{{ unit }}</span
            >
        </div>
        <InputError :id="errorId" :message="message" />
    </div>
</template>
