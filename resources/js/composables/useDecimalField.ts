import { computed, nextTick, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useFormatContext } from '@/composables/useFormat';
import { numberSeparators } from '@/lib/format';
import type { NumberSeparators } from '@/lib/format';

/** What typed text means: a value (or `null`) and the message if it is wrong. */
export type DecimalReading = { value: number | null; error: string | null };

export type DecimalFieldOptions = {
    /** The current model value. */
    model: () => number | null;
    /** Typed text to a value. `separators` are the business locale's. */
    read: (text: string, separators: NumberSeparators) => DecimalReading;
    /** The text of a value when the field is not being edited. */
    show: (value: number | null, separators: NumberSeparators) => string;
    /** The text of a value while editing (no grouping); default: `show`. */
    edit?: (value: number, separators: NumberSeparators) => string;
    /** Send a value (or `null`) to the parent. */
    emit: (value: number | null) => void;
};

export type DecimalField = {
    text: Ref<string>;
    error: Ref<string | null>;
    focused: Ref<boolean>;
    separators: ComputedRef<NumberSeparators>;
    onInput: (value: string | number) => void;
    onFocus: (event: FocusEvent) => void;
    onBlur: () => void;
    /** Enter: commit, but leave the text alone while the field has focus. */
    onEnter: () => void;
    /** Re-draw the text from the model unless the field is being edited. */
    refresh: () => void;
};

/**
 * The lifecycle `CurrencyInput` and `PercentInput` share: a text field over a
 * number, in the business locale's decimal and group separators.
 *
 * - Typing emits every readable value at once (`null` for an unreadable one)
 *   but raises errors only on blur or Enter; an error is cleared as soon as
 *   the text reads cleanly.
 * - Focus swaps in the ungrouped edit text and selects it; blur (not Enter)
 *   re-draws the formatted text.
 * - Outside changes to the model re-draw the text unless the field has focus,
 *   so the caret is never fought while typing.
 */
export function useDecimalField(options: DecimalFieldOptions): DecimalField {
    const context = useFormatContext();
    const separators = computed(() => numberSeparators(context().locale));
    const text = ref(options.show(options.model(), separators.value));
    const focused = ref(false);
    const error = ref<string | null>(null);

    function onInput(value: string | number): void {
        text.value = String(value);

        const reading = options.read(text.value, separators.value);

        // An error is only ever *cleared* mid-edit; it is raised on commit.
        if (reading.error === null) {
            error.value = null;
        }

        if (reading.value !== options.model()) {
            options.emit(reading.value);
        }
    }

    function commit(reformat: boolean): void {
        const reading = options.read(text.value, separators.value);

        error.value = reading.error;
        options.emit(reading.value);

        if (reformat && reading.error === null) {
            text.value = options.show(reading.value, separators.value);
        }
    }

    function onFocus(event: FocusEvent): void {
        focused.value = true;

        const input = event.target as HTMLInputElement;
        const model = options.model();

        // Edit without grouping separators: `12345.67`, not `12,345.67`.
        if (error.value === null && model !== null) {
            text.value = (options.edit ?? options.show)(
                model,
                separators.value,
            );
        }

        void nextTick(() => input.select());
    }

    function onBlur(): void {
        focused.value = false;
        commit(true);
    }

    function onEnter(): void {
        commit(!focused.value);
    }

    function refresh(): void {
        if (!focused.value) {
            text.value = options.show(options.model(), separators.value);
        }
    }

    watch(options.model, () => {
        if (!focused.value) {
            refresh();
            error.value = null;
        }
    });
    watch(separators, refresh);

    return {
        text,
        error,
        focused,
        separators,
        onInput,
        onFocus,
        onBlur,
        onEnter,
        refresh,
    };
}
