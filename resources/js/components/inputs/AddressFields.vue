<script setup lang="ts">
import { computed, onMounted, useId } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useBusinessCountry } from '@/composables/useBusinessCountry';
import { useControlSize } from '@/composables/useControlSize';
import { useFormatContext } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { countryOptions } from '@/lib/countries';
import type { AddressFormData } from '@/types/forms';

// 15 §9.26. One address as a form: label, line1*, line2, city*, region,
// postalCode and countryCode* (a `Select`). `errors` is keyed by wire name
// behind `errorPrefix`, e.g. `siteAddress.line1`. Max lengths are 02 §1.2's
// column sizes. An empty `countryCode` becomes `business.defaultCountryCode`
// (both shown and emitted, so the form really submits it).
const props = withDefaults(
    defineProps<{
        modelValue: AddressFormData;
        /** Validation messages by field key, each behind `errorPrefix`. */
        errors?: Record<string, string>;
        /** e.g. `siteAddress.` */
        errorPrefix?: string;
        disabled?: boolean;
    }>(),
    { errors: undefined, errorPrefix: '' },
);

const emit = defineEmits<{
    'update:modelValue': [address: AddressFormData];
}>();

type TextKey = 'label' | 'line1' | 'line2' | 'city' | 'region' | 'postalCode';
type Field =
    | {
          key: TextKey;
          labelKey: string;
          maxlength: number;
          autocomplete: string;
          required?: true;
          wide?: true;
          placeholderKey?: string;
      }
    | { key: 'countryCode'; labelKey: string; required: true };

const FIELDS: Field[] = [
    {
        key: 'label',
        labelKey: 'common.address.label',
        maxlength: 60,
        autocomplete: 'off',
        wide: true,
        placeholderKey: 'common.address.label_placeholder',
    },
    {
        key: 'line1',
        labelKey: 'common.address.line1',
        maxlength: 200,
        autocomplete: 'address-line1',
        required: true,
        wide: true,
    },
    {
        key: 'line2',
        labelKey: 'common.address.line2',
        maxlength: 200,
        autocomplete: 'address-line2',
        wide: true,
    },
    {
        key: 'city',
        labelKey: 'common.address.city',
        maxlength: 100,
        autocomplete: 'address-level2',
        required: true,
    },
    {
        key: 'region',
        labelKey: 'common.address.region',
        maxlength: 100,
        autocomplete: 'address-level1',
    },
    {
        key: 'postalCode',
        labelKey: 'common.address.postal_code',
        maxlength: 20,
        autocomplete: 'postal-code',
    },
    { key: 'countryCode', labelKey: 'common.address.country', required: true },
];

// A typographic mark, hidden from assistive tech (`aria-required` says it).
const REQUIRED_MARK = '*';

const { t, locale } = useI18n();
const size = useControlSize();
const context = useFormatContext();
const businessCountry = useBusinessCountry();
const uid = useId();

const countries = computed(() =>
    countryOptions(locale.value || context().locale, businessCountry.value),
);
const country = computed(
    () => props.modelValue.countryCode || businessCountry.value,
);
const countryName = computed(
    () =>
        countries.value.find((option) => option.code === country.value)?.name ??
        country.value,
);

const idFor = (key: string): string => `${uid}-${key}`;
const errorIdFor = (key: string): string => `${uid}-${key}-error`;
const errorFor = (key: string): string | undefined =>
    props.errors?.[`${props.errorPrefix}${key}`];

function update(key: keyof AddressFormData, value: string): void {
    emit('update:modelValue', { ...props.modelValue, [key]: value });
}

onMounted(() => {
    if (!props.modelValue.countryCode) {
        update('countryCode', businessCountry.value);
    }
});
</script>

<template>
    <div class="grid gap-4 sm:grid-cols-2">
        <div
            v-for="field in FIELDS"
            :key="field.key"
            :data-field="field.key"
            :class="[
                'space-y-2',
                'wide' in field && field.wide && 'sm:col-span-2',
            ]"
        >
            <Label :for="idFor(field.key)">
                {{ t(field.labelKey) }}
                <span v-if="field.required" aria-hidden="true">{{
                    REQUIRED_MARK
                }}</span>
            </Label>

            <Select
                v-if="field.key === 'countryCode'"
                :model-value="country"
                :disabled="disabled"
                required
                @update:model-value="update('countryCode', String($event))"
            >
                <SelectTrigger
                    :id="idFor(field.key)"
                    :size="size"
                    class="w-full"
                    :aria-invalid="errorFor(field.key) ? 'true' : undefined"
                    :aria-describedby="
                        errorFor(field.key) ? errorIdFor(field.key) : undefined
                    "
                >
                    <SelectValue>{{ countryName }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem
                        v-for="option in countries"
                        :key="option.code"
                        :value="option.code"
                        class="min-h-11 lg:min-h-8"
                    >
                        {{ option.name }}
                    </SelectItem>
                </SelectContent>
            </Select>

            <Input
                v-else
                :id="idFor(field.key)"
                :model-value="modelValue[field.key] ?? ''"
                :size="size"
                type="text"
                :maxlength="field.maxlength"
                :autocomplete="field.autocomplete"
                :placeholder="
                    field.placeholderKey ? t(field.placeholderKey) : undefined
                "
                :disabled="disabled"
                :aria-required="field.required ? 'true' : undefined"
                :aria-invalid="errorFor(field.key) ? 'true' : undefined"
                :aria-describedby="
                    errorFor(field.key) ? errorIdFor(field.key) : undefined
                "
                @update:model-value="update(field.key, String($event))"
            />

            <InputError
                :id="errorIdFor(field.key)"
                :message="errorFor(field.key)"
            />
        </div>
    </div>
</template>
