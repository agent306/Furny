<script setup lang="ts">
import { computed } from 'vue';
import type { StyleValue } from 'vue';
import { useFormat } from '@/composables/useFormat';
import { PLACEHOLDER } from '@/lib/format';
import type { DateStyle } from '@/lib/format';

// 15 §9.28. A date-only value (`2026-10-20`) is a calendar date and is printed
// as is, in no time zone; an instant is shown in the user's zone.
//
// `style` is the spec-mandated name of the date style prop, but Vue also
// routes a `:style` binding to a declared prop of that name, so the root
// element would never receive it. The prop therefore also accepts a Vue
// `StyleValue` (an object or an array): anything that is not 'short' |
// 'medium' | 'long' is applied to the <time> element as inline style.
// Caveat: a static `style="short"` attribute is parsed by the template
// compiler as CSS text; pass `:style="'short'"` (or use `class`, which falls
// through normally).
//
// `dateStyle` is a non-spec alias and the PREFERRED prop for new code: it has
// no such clash, so `<DateText date-style="long" />` and a real `:style`
// binding work together. When both are given, `dateStyle` wins.
const props = withDefaults(
    defineProps<{
        value: string;
        kind: 'date' | 'datetime' | 'time';
        style?: DateStyle | StyleValue;
        /** Preferred over `style`; takes precedence when both are given. */
        dateStyle?: DateStyle;
    }>(),
    { style: 'medium', dateStyle: undefined },
);

const { formatDate, formatDateTime, formatTime } = useFormat();

const DATE_STYLES: readonly unknown[] = ['short', 'medium', 'long'];

const resolvedStyle = computed<DateStyle>(() => {
    if (props.dateStyle !== undefined) {
        return props.dateStyle;
    }

    return DATE_STYLES.includes(props.style)
        ? (props.style as DateStyle)
        : 'medium';
});
// A string style keyword never reaches the element; anything else is CSS. With
// `dateStyle` set, `style` is free to be plain CSS.
const inlineStyle = computed(() =>
    DATE_STYLES.includes(props.style) ? undefined : (props.style as StyleValue),
);

const text = computed(() => {
    switch (props.kind) {
        case 'date':
            return formatDate(props.value, resolvedStyle.value);
        case 'datetime':
            return formatDateTime(props.value, resolvedStyle.value);
        default:
            return formatTime(props.value, resolvedStyle.value);
    }
});
</script>

<template>
    <time
        :datetime="text === PLACEHOLDER ? undefined : value"
        :style="inlineStyle"
        >{{ text }}</time
    >
</template>
