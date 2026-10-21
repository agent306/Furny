<script setup lang="ts">
import {
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/composables/useTheme';
import type { Appearance } from '@/composables/useTheme';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { IconName } from '@/lib/icons';

// Light / Dark / System (15 §11), shared by `ThemeToggle` and the `UserMenu`
// theme submenu. Must sit inside a DropdownMenu content.
const { t } = useI18n();
const { appearance, setAppearance } = useTheme();

const OPTIONS: { value: Appearance; labelKey: string; icon: IconName }[] = [
    { value: 'light', labelKey: 'common.theme.light', icon: 'sun' },
    { value: 'dark', labelKey: 'common.theme.dark', icon: 'moon' },
    { value: 'system', labelKey: 'common.theme.system', icon: 'monitor' },
];

function onChange(value: unknown): void {
    if (value === 'light' || value === 'dark' || value === 'system') {
        setAppearance(value);
    }
}
</script>

<template>
    <DropdownMenuRadioGroup
        :model-value="appearance"
        @update:model-value="onChange"
    >
        <DropdownMenuRadioItem
            v-for="option in OPTIONS"
            :key="option.value"
            :value="option.value"
            :data-test="`theme-${option.value}`"
            class="min-h-11 lg:min-h-0"
        >
            <component
                :is="ICONS[option.icon]"
                class="size-4"
                aria-hidden="true"
            />
            {{ t(option.labelKey) }}
        </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
</template>
