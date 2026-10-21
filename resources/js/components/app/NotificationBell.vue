<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';

// 15 §9.17, 12 §8.4: the shell of the bell. The count is the shared
// `unreadNotifications` prop; the list, mark-as-read and live updates arrive
// with the notification centre (P8).
const MAX_SHOWN = 99;

const { t } = useI18n();
const page = usePage();
const controlSize = useControlSize();

const count = computed(() => page.props.unreadNotifications ?? 0);
const shown = computed(() =>
    count.value > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count.value),
);
const buttonSize = computed(() =>
    controlSize.value === 'lg' ? 'icon-lg' : 'icon',
);
</script>

<template>
    <DropdownMenu>
        <DropdownMenuTrigger as-child>
            <Button
                variant="ghost"
                :size="buttonSize"
                class="relative max-lg:size-11"
                :aria-label="t('notifications.bell.aria', { count })"
                data-test="notification-bell"
            >
                <component :is="ICONS.bell" class="size-5" aria-hidden="true" />
                <span
                    v-if="count > 0"
                    data-test="notification-count"
                    aria-hidden="true"
                    class="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground tabular-nums"
                    >{{ shown }}</span
                >
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
            align="end"
            class="max-h-[480px] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto"
        >
            <DropdownMenuLabel>{{
                t('notifications.title')
            }}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <p
                data-test="notifications-empty"
                class="px-2 py-8 text-center text-sm text-muted-foreground"
            >
                {{ t('notifications.empty') }}
            </p>
        </DropdownMenuContent>
    </DropdownMenu>
</template>
