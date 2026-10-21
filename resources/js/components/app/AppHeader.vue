<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { computed } from 'vue';
import AppLogo from '@/components/app/AppLogo.vue';
import NotificationBell from '@/components/app/NotificationBell.vue';
import ThemeToggle from '@/components/app/ThemeToggle.vue';
import UserMenu from '@/components/app/UserMenu.vue';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useCurrentUrl } from '@/composables/useCurrentUrl';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { dashboard as customerDashboard } from '@/routes/customer';
import type { BreadcrumbItem as Crumb, NavItem } from '@/types';

// 15 §7.1 (customer) and §7.2 (admin top bar). The customer header carries the
// logo, the primary links (desktop), the menu sheet (tablet), the bell and the
// account menu. The admin top bar carries the sidebar trigger, the breadcrumbs,
// the bell, the theme toggle and the account menu.
//
// The account menu stays on phones too: until the account pages (Task 34) the
// tab bar has no Account tab, so it is the only way to log out there.
const props = withDefaults(
    defineProps<{
        variant: 'customer' | 'admin';
        /** Customer primary navigation. */
        nav?: readonly NavItem[];
        /** Admin breadcrumbs; the last one is the page title on phones. */
        breadcrumbs?: readonly Crumb[];
    }>(),
    { nav: () => [], breadcrumbs: () => [] },
);

const { t } = useI18n();
const { isCurrentUrl, isCurrentOrParentUrl } = useCurrentUrl();

const pageTitle = computed(() => props.breadcrumbs.at(-1)?.title ?? '');

function isActive(item: NavItem): boolean {
    return item.exact
        ? isCurrentUrl(item.href)
        : isCurrentOrParentUrl(item.href);
}
</script>

<template>
    <header
        v-if="variant === 'customer'"
        data-test="customer-header"
        class="sticky top-0 z-30 h-16 shrink-0 border-b bg-background/90 backdrop-blur"
    >
        <div
            class="mx-auto flex h-full max-w-6xl items-center gap-2 px-4 sm:px-6 lg:px-8"
        >
            <Sheet>
                <SheetTrigger as-child>
                    <Button
                        variant="ghost"
                        size="icon-lg"
                        class="-ml-2 hidden md:inline-flex lg:hidden"
                        :aria-label="t('a11y.open_menu')"
                        data-test="menu-trigger"
                    >
                        <component
                            :is="ICONS.menu"
                            class="size-5"
                            aria-hidden="true"
                        />
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" class="w-72">
                    <SheetHeader>
                        <SheetTitle>{{ t('a11y.main_navigation') }}</SheetTitle>
                        <SheetDescription class="sr-only">{{
                            t('a11y.menu_description')
                        }}</SheetDescription>
                    </SheetHeader>
                    <nav :aria-label="t('a11y.main_navigation')" class="px-2">
                        <ul class="space-y-1">
                            <li v-for="item in nav" :key="item.key">
                                <Link
                                    :href="item.href"
                                    :aria-current="
                                        isActive(item) ? 'page' : undefined
                                    "
                                    :class="
                                        cn(
                                            'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-accent',
                                            isActive(item) &&
                                                'bg-accent font-medium',
                                        )
                                    "
                                >
                                    <component
                                        :is="ICONS[item.icon]"
                                        class="size-5"
                                        aria-hidden="true"
                                    />
                                    {{ t(item.labelKey) }}
                                </Link>
                            </li>
                        </ul>
                    </nav>
                </SheetContent>
            </Sheet>

            <Link
                :href="customerDashboard()"
                class="flex min-h-11 items-center rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
                <AppLogo />
            </Link>

            <nav
                :aria-label="t('a11y.main_navigation')"
                class="ml-6 hidden h-full lg:block"
            >
                <ul class="flex h-full items-stretch gap-6">
                    <li v-for="item in nav" :key="item.key" class="flex">
                        <Link
                            :href="item.href"
                            :aria-current="isActive(item) ? 'page' : undefined"
                            :class="
                                cn(
                                    'flex items-center border-b-2 border-transparent px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                                    isActive(item) &&
                                        'border-primary font-medium text-foreground',
                                )
                            "
                        >
                            {{ t(item.labelKey) }}
                        </Link>
                    </li>
                </ul>
            </nav>

            <div class="ml-auto flex items-center gap-1">
                <NotificationBell />
                <UserMenu />
            </div>
        </div>
    </header>

    <header
        v-else
        data-test="admin-header"
        class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4"
    >
        <SidebarTrigger class="-ml-1 size-11 lg:size-9" />

        <Breadcrumb
            v-if="breadcrumbs.length > 0"
            class="hidden min-w-0 md:block"
        >
            <BreadcrumbList>
                <template v-for="(crumb, index) in breadcrumbs" :key="index">
                    <BreadcrumbItem>
                        <BreadcrumbLink
                            v-if="crumb.href && index < breadcrumbs.length - 1"
                            as-child
                        >
                            <Link :href="crumb.href">{{ crumb.title }}</Link>
                        </BreadcrumbLink>
                        <BreadcrumbPage v-else>{{
                            crumb.title
                        }}</BreadcrumbPage>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator
                        v-if="index < breadcrumbs.length - 1"
                    />
                </template>
            </BreadcrumbList>
        </Breadcrumb>
        <p
            v-if="pageTitle"
            class="min-w-0 truncate text-sm font-medium md:hidden"
            data-test="phone-title"
        >
            {{ pageTitle }}
        </p>

        <div class="ml-auto flex items-center gap-1">
            <NotificationBell />
            <div class="hidden md:block">
                <ThemeToggle />
            </div>
            <UserMenu />
        </div>
    </header>
</template>
