<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { computed } from 'vue';
import { useCurrentUrl } from '@/composables/useCurrentUrl';
import { useI18n } from '@/composables/useI18n';
import { accountNavItems } from '@/lib/account';
import type { AccountAudience } from '@/lib/account';
import { cn } from '@/lib/utils';

// 10 §13.1, 11 §18: the sections of the account area. A vertical list 220 px wide from 1024 px; below that, pills in a
// row that scrolls sideways. The current section is `aria-current="page"`.
const props = defineProps<{ audience: AccountAudience }>();

const { t } = useI18n();
const { isCurrentUrl } = useCurrentUrl();

const items = computed(() => accountNavItems(props.audience));
</script>

<template>
    <nav
        :aria-label="t('account.nav.label')"
        data-test="account-nav"
        class="lg:w-[220px] lg:shrink-0"
    >
        <ul
            class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
        >
            <li v-for="item in items" :key="item.key" class="shrink-0">
                <Link
                    :href="item.href"
                    :aria-current="isCurrentUrl(item.href) ? 'page' : undefined"
                    :data-test="`account-nav-${item.key}`"
                    :class="
                        cn(
                            'flex min-h-11 items-center rounded-full border px-4 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:rounded-md lg:border-transparent',
                            isCurrentUrl(item.href) &&
                                'border-primary/40 bg-accent font-medium text-foreground',
                        )
                    "
                >
                    {{ t(item.labelKey) }}
                </Link>
            </li>
        </ul>
    </nav>
</template>
