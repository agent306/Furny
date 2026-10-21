<script setup lang="ts">
import { ChevronsUpDown, Check } from '@lucide/vue';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { computed, nextTick, ref, useId, watch } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Button } from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    FALLBACK_COUNTRY,
    useBusinessCountry,
} from '@/composables/useBusinessCountry';
import { useControlSize } from '@/composables/useControlSize';
import { useFormatContext } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { countryOptions, isCountryCode } from '@/lib/countries';
import type { CountryCode } from '@/lib/countries';
import { inputAttrs, rootAttrs } from '@/lib/fieldAttrs';

// 15 §9.25. A country selector (a searchable list in a popover: flag, name and
// calling code; the business country first, then IN, AE, SG, GB, US) beside the
// national number field. The model is E.164 or `null`.
//
// Typing emits at once: a number that `libphonenumber-js/min` calls valid is
// emitted as E.164, anything else as `null`; the error appears on blur / Enter
// (or when a country change invalidates the number). A full `+…` number (a
// paste, autofill) switches the selector to its country. Once the field is
// left it shows the national format; outside changes to `modelValue` re-read
// the number unless it is the echo of our own emit. Extensions are not part of
// E.164, so the text may hold only digits and `+ ( ) . -` and spaces.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
    defineProps<{
        /** E.164, e.g. `+919876543210`. */
        modelValue: string | null;
        /** ISO-3166 alpha-2; default `business.defaultCountryCode`. */
        defaultCountry?: string;
        disabled?: boolean;
        invalid?: boolean;
    }>(),
    { defaultCountry: undefined },
);

const emit = defineEmits<{
    'update:modelValue': [e164: string | null];
}>();

const { t, locale } = useI18n();
const size = useControlSize();
const context = useFormatContext();
const businessCountry = useBusinessCountry();
const errorId = useId();
const listId = useId();

function fallbackCountry(): CountryCode {
    const wanted = (
        props.defaultCountry ?? businessCountry.value
    ).toUpperCase();

    return isCountryCode(wanted) ? wanted : FALLBACK_COUNTRY;
}

const options = computed(() =>
    countryOptions(locale.value || context().locale, businessCountry.value),
);
const optionByCode = computed(
    () => new Map(options.value.map((option) => [option.code, option])),
);

const country = ref<CountryCode>(fallbackCountry());
const text = ref('');
const error = ref(false);
const open = ref(false);
const numberInput = ref<{ $el: HTMLInputElement } | null>(null);
// What we last put into `update:modelValue`, so its echo is not re-read.
let emitted: string | null = props.modelValue;

const selected = computed(() => optionByCode.value.get(country.value));

// Digits, one leading `+`, and the usual separators; letters and extensions
// make the whole number unreadable.
const SEPARATORS = /[\s().‐-―-]/g;
const PLAUSIBLE = /^\+?\d+$/;

type Reading = {
    e164: string;
    country: CountryCode;
    national: string;
};

function read(value: string, region: CountryCode): Reading | null {
    const compact = value.replace(SEPARATORS, '');

    if (!PLAUSIBLE.test(compact)) {
        return null;
    }

    const number = parsePhoneNumberFromString(compact, region);

    if (!number?.isValid()) {
        return null;
    }

    return {
        e164: number.number,
        country: number.country ?? region,
        national: number.formatNational(),
    };
}

function load(value: string | null): void {
    emitted = value;
    error.value = false;

    if (value === null) {
        text.value = '';

        return;
    }

    const reading = read(value, country.value);

    if (reading) {
        country.value = reading.country;
        text.value = reading.national;
    } else {
        text.value = value;
    }
}

load(props.modelValue);

function publish(e164: string | null): void {
    emitted = e164;
    emit('update:modelValue', e164);
}

function onInput(value: string | number): void {
    text.value = String(value);

    const reading = read(text.value, country.value);

    if (reading) {
        error.value = false;
        // A full international number carries its own country.
        country.value = reading.country;
        publish(reading.e164);
    } else if (emitted !== null) {
        publish(null);
    }
}

function finish(): void {
    if (text.value.trim() === '') {
        error.value = false;
        publish(null);

        return;
    }

    const reading = read(text.value, country.value);

    if (reading) {
        error.value = false;
        country.value = reading.country;
        text.value = reading.national;
        publish(reading.e164);
    } else {
        error.value = true;
        publish(null);
    }
}

function pick(value: unknown): void {
    if (typeof value !== 'string' || !isCountryCode(value)) {
        return;
    }

    country.value = value;
    open.value = false;

    if (text.value.trim() !== '') {
        // The number was typed for another country: read it again here.
        finish();
    }

    void nextTick(() => numberInput.value?.$el.focus());
}

watch(
    () => props.modelValue,
    (value) => {
        if (value !== emitted) {
            load(value);
        }
    },
);

watch(
    () => props.defaultCountry,
    () => {
        if (text.value === '' && props.modelValue === null) {
            country.value = fallbackCountry();
        }
    },
);

const message = computed(() =>
    error.value ? t('phone.errors.invalid') : undefined,
);
const triggerLabel = computed(
    () =>
        `${t('phone.country')}: ${selected.value?.name ?? country.value} +${selected.value?.callingCode ?? ''}`,
);
</script>

<template>
    <div v-bind="rootAttrs($attrs)">
        <div class="flex items-start gap-2">
            <Popover v-model:open="open">
                <PopoverTrigger as-child>
                    <Button
                        data-slot="phone-country"
                        :data-country="country"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-haspopup="listbox"
                        :aria-expanded="open ? 'true' : 'false'"
                        :aria-controls="open ? listId : undefined"
                        :aria-label="triggerLabel"
                        :disabled="disabled"
                        :size="size"
                        class="shrink-0 gap-1.5 px-3 font-normal"
                    >
                        <span aria-hidden="true">{{ selected?.flag }}</span>
                        <span class="font-mono text-sm tabular-nums"
                            >+{{ selected?.callingCode }}</span
                        >
                        <ChevronsUpDown class="size-4 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" class="w-80 p-0">
                    <Command
                        :id="listId"
                        :model-value="country"
                        @update:model-value="pick"
                    >
                        <CommandInput
                            :placeholder="t('phone.search_country')"
                            :aria-label="t('phone.search_country')"
                        />
                        <CommandList>
                            <CommandEmpty>{{
                                t('phone.no_country')
                            }}</CommandEmpty>
                            <CommandGroup>
                                <CommandItem
                                    v-for="option in options"
                                    :key="option.code"
                                    :value="option.code"
                                    class="min-h-11 lg:min-h-9"
                                >
                                    <span aria-hidden="true">{{
                                        option.flag
                                    }}</span>
                                    <span class="min-w-0 flex-1 truncate">{{
                                        option.name
                                    }}</span>
                                    <span
                                        class="font-mono text-xs text-muted-foreground tabular-nums"
                                        >+{{ option.callingCode }}</span
                                    >
                                    <Check
                                        v-if="option.code === country"
                                        class="size-4"
                                    />
                                </CommandItem>
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <Input
                ref="numberInput"
                v-bind="inputAttrs($attrs, message ? errorId : undefined)"
                :model-value="text"
                :size="size"
                type="tel"
                inputmode="tel"
                autocomplete="tel-national"
                :disabled="disabled"
                :aria-invalid="invalid || message ? 'true' : undefined"
                class="min-w-0 flex-1"
                @update:model-value="onInput"
                @blur="finish"
                @keydown.enter="finish"
            />
        </div>
        <InputError :id="errorId" :message="message" />
    </div>
</template>
