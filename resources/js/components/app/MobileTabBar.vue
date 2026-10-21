<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { computed } from 'vue';
import { useCurrentUrl } from '@/composables/useCurrentUrl';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/types';

// 15 §7.1: the customer app's phone navigation. Fixed at the bottom, h-16 plus
// the safe-area inset, every target at least 44 x 44 px (§14 item 6).
const props = defineProps<{
    items: readonly NavItem[];
}>();

const { t } = useI18n();
const { isCurrentUrl, isCurrentOrParentUrl } = useCurrentUrl();

const tabs = computed(() => props.items.filter((item) => item.tab === true));

function isActive(item: NavItem): boolean {
    return item.exact
        ? isCurrentUrl(item.href)
        : isCurrentOrParentUrl(item.href);
}
</script>

<template>
    <nav
        :aria-label="t('a11y.tab_bar')"
        data-test="mobile-tab-bar"
        class="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
        <ul class="flex h-16 items-stretch justify-around">
            <li
                v-for="item in tabs"
                :key="item.key"
                class="flex min-w-11 flex-1"
            >
                <Link
                    :href="item.href"
                    :aria-current="isActive(item) ? 'page' : undefined"
                    :data-active="isActive(item)"
                    :class="
                        cn(
                            'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                            isActive(item) && 'font-medium text-primary',
                        )
                    "
                >
                    <component
                        :is="ICONS[item.icon]"
                        :class="
                            cn('size-6', isActive(item) && 'fill-primary/15')
                        "
                        aria-hidden="true"
                    />
                    <span>{{ t(item.tabLabelKey ?? item.labelKey) }}</span>
                </Link>
            </li>
        </ul>
    </nav>
</template>
