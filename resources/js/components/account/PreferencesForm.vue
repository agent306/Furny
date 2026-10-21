<script setup lang="ts">
import { useForm } from '@inertiajs/vue3';
import { Check, ChevronsUpDown } from '@lucide/vue';
import { computed, ref } from 'vue';
import FormSection from '@/components/common/FormSection.vue';
import InputError from '@/components/common/InputError.vue';
import StickyActionBar from '@/components/common/StickyActionBar.vue';
import { Button } from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useControlSize } from '@/composables/useControlSize';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useTheme } from '@/composables/useTheme';
import type { Appearance } from '@/composables/useTheme';
import { accountUrls } from '@/lib/account';
import type { AccountAudience } from '@/lib/account';
import type { LengthUnit, UnitSystem } from '@/types';

// 10 §13.4, 11 §18: the measurement system, the editing length unit (it starts again from the system's usual one when the
// system changes) and the time zone; then the appearance, which belongs to this device (15 §11) and is not saved to the
// account. Saving sends camelCase keys to the audience's `preferences.update`.
const props = defineProps<{
    audience: AccountAudience;
    unitSystem: UnitSystem;
    lengthUnit: LengthUnit;
    timezone: string;
    timezones: string[];
}>();

const FORM_ID = 'preferences-form';

const UNITS: Record<UnitSystem, LengthUnit[]> = {
    metric: ['mm', 'cm', 'm'],
    imperial: ['ftin', 'in'],
};
// What the length unit becomes when the system changes: the finest unit of the system.
const DEFAULT_UNIT: Record<UnitSystem, LengthUnit> = {
    metric: 'mm',
    imperial: 'ftin',
};

const { t } = useI18n();
const size = useControlSize();
const { focusFirstError } = useFocusFirstError();
const { appearance, setAppearance } = useTheme();

const form = useForm({
    unitSystem: props.unitSystem,
    lengthUnit: props.lengthUnit,
    timezone: props.timezone,
});

const lengthUnits = computed(() => UNITS[form.unitSystem]);

function chooseSystem(value: unknown): void {
    if (value !== 'metric' && value !== 'imperial') {
        return;
    }

    if (value !== form.unitSystem) {
        form.unitSystem = value;
        form.lengthUnit = DEFAULT_UNIT[value];
    }
}

function submit(): void {
    form.put(accountUrls(props.audience).preferences, {
        preserveScroll: true,
        onSuccess: () => form.defaults().reset(),
        onError: () => void focusFirstError(),
    });
}

function discard(): void {
    form.reset();
    form.clearErrors();
}

// The time zone: a searchable list in a popover.
const zoneOpen = ref(false);

function chooseZone(zone: unknown): void {
    if (typeof zone === 'string') {
        form.timezone = zone;
    }

    zoneOpen.value = false;
}

const APPEARANCES: Appearance[] = ['light', 'dark', 'system'];

function chooseAppearance(value: unknown): void {
    if (value === 'light' || value === 'dark' || value === 'system') {
        setAppearance(value);
    }
}
</script>

<template>
    <form
        :id="FORM_ID"
        class="divide-y"
        novalidate
        data-test="preferences-form"
        @submit.prevent="submit"
    >
        <FormSection
            :title="t('account.preferences.units.title')"
            :description="t('account.preferences.units.description')"
        >
            <RadioGroup
                :model-value="form.unitSystem"
                name="unitSystem"
                class="grid gap-3 sm:grid-cols-2"
                :aria-invalid="form.errors.unitSystem ? 'true' : undefined"
                data-test="unit-system"
                @update:model-value="chooseSystem"
            >
                <Label
                    v-for="system in ['metric', 'imperial'] as const"
                    :key="system"
                    :for="`system-${system}`"
                    class="flex min-h-11 items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
                >
                    <RadioGroupItem
                        :id="`system-${system}`"
                        :value="system"
                        class="mt-0.5"
                        :data-test="`system-${system}`"
                    />
                    <span class="grid gap-0.5">
                        <span class="font-medium">{{
                            t(`account.preferences.units.${system}`)
                        }}</span>
                        <span class="text-sm text-muted-foreground">{{
                            t(`account.preferences.units.${system}_hint`)
                        }}</span>
                    </span>
                </Label>
            </RadioGroup>
            <InputError
                id="unit-system-error"
                :message="form.errors.unitSystem"
            />

            <div class="grid gap-2">
                <Label for="length-unit">{{
                    t('account.preferences.length_unit.label')
                }}</Label>
                <NativeSelect
                    id="length-unit"
                    :key="form.unitSystem"
                    v-model="form.lengthUnit"
                    name="lengthUnit"
                    class="w-full sm:w-72"
                    :class="size === 'lg' ? '[&_select]:h-11' : ''"
                    :aria-invalid="form.errors.lengthUnit ? 'true' : undefined"
                    :aria-describedby="
                        form.errors.lengthUnit
                            ? 'length-unit-error'
                            : 'length-unit-hint'
                    "
                    data-test="length-unit"
                >
                    <option
                        v-for="unit in lengthUnits"
                        :key="unit"
                        :value="unit"
                    >
                        {{ t(`account.preferences.length_unit.${unit}`) }}
                    </option>
                </NativeSelect>
                <p id="length-unit-hint" class="text-sm text-muted-foreground">
                    {{ t('account.preferences.length_unit.hint') }}
                </p>
                <InputError
                    id="length-unit-error"
                    :message="form.errors.lengthUnit"
                />
            </div>
        </FormSection>

        <FormSection
            :title="t('account.preferences.timezone.title')"
            :description="t('account.preferences.timezone.description')"
        >
            <div class="grid gap-2">
                <Label for="timezone">{{
                    t('account.preferences.timezone.label')
                }}</Label>
                <Popover v-model:open="zoneOpen">
                    <PopoverTrigger as-child>
                        <Button
                            id="timezone"
                            type="button"
                            variant="outline"
                            role="combobox"
                            :size="size"
                            :aria-expanded="zoneOpen"
                            :aria-invalid="
                                form.errors.timezone ? 'true' : undefined
                            "
                            :aria-describedby="
                                form.errors.timezone
                                    ? 'timezone-error'
                                    : undefined
                            "
                            class="w-full justify-between sm:w-72"
                            data-test="timezone"
                        >
                            <span class="truncate">{{ form.timezone }}</span>
                            <ChevronsUpDown
                                class="size-4 shrink-0 opacity-50"
                                aria-hidden="true"
                            />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent class="w-72 p-0" align="start">
                        <Command @update:model-value="chooseZone">
                            <CommandInput
                                :placeholder="
                                    t('account.preferences.timezone.search')
                                "
                            />
                            <CommandList>
                                <CommandEmpty>{{
                                    t('account.preferences.timezone.empty')
                                }}</CommandEmpty>
                                <!-- The items render only inside a group (the vendored Command, as in PhoneInput). -->
                                <CommandGroup>
                                    <CommandItem
                                        v-for="zone in timezones"
                                        :key="zone"
                                        :value="zone"
                                        class="min-h-11 lg:min-h-0"
                                    >
                                        <Check
                                            class="size-4"
                                            :class="
                                                zone === form.timezone
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            "
                                            aria-hidden="true"
                                        />
                                        {{ zone }}
                                    </CommandItem>
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
                <InputError
                    id="timezone-error"
                    :message="form.errors.timezone"
                />
            </div>
        </FormSection>

        <!-- Above the phone tab bar of the customer app (h-16 and the safe-area inset). -->
        <StickyActionBar
            :class="
                audience === 'customer' &&
                'max-md:bottom-[calc(4rem+env(safe-area-inset-bottom))]'
            "
            :dirty="form.isDirty"
            :processing="form.processing"
            :form="FORM_ID"
            @discard="discard"
        />
    </form>

    <FormSection
        :title="t('account.preferences.appearance.title')"
        :description="t('account.preferences.appearance.description')"
    >
        <RadioGroup
            :model-value="appearance"
            name="appearance"
            class="grid gap-3 sm:grid-cols-3"
            data-test="appearance"
            @update:model-value="chooseAppearance"
        >
            <Label
                v-for="option in APPEARANCES"
                :key="option"
                :for="`appearance-${option}`"
                class="flex min-h-11 items-center gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
            >
                <RadioGroupItem
                    :id="`appearance-${option}`"
                    :value="option"
                    :data-test="`appearance-${option}`"
                />
                {{ t(`common.theme.${option}`) }}
            </Label>
        </RadioGroup>
    </FormSection>
</template>
