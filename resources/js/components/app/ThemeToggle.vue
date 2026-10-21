<script setup lang="ts">
import { computed } from 'vue';
import ThemeMenuItems from '@/components/app/ThemeMenuItems.vue';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { useTheme } from '@/composables/useTheme';
import { ICONS } from '@/lib/icons';

// 15 §9.31: a DropdownMenu with Light / Dark / System (admin top bar; the
// customer app has the same choice inside the UserMenu).
const { t } = useI18n();
const { resolved } = useTheme();
const controlSize = useControlSize();
const buttonSize = computed(() =>
    controlSize.value === 'lg' ? 'icon-lg' : 'icon',
);
</script>

<template>
    <DropdownMenu>
        <Tooltip>
            <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                    <Button
                        variant="ghost"
                        :size="buttonSize"
                        class="max-lg:size-11"
                        :aria-label="t('common.theme.label')"
                        data-test="theme-toggle"
                    >
                        <component
                            :is="ICONS[resolved === 'dark' ? 'moon' : 'sun']"
                            class="size-5"
                            aria-hidden="true"
                        />
                    </Button>
                </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{{ t('common.theme.label') }}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" class="min-w-40">
            <ThemeMenuItems />
        </DropdownMenuContent>
    </DropdownMenu>
</template>
