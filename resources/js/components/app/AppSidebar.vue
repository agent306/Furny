<script setup lang="ts">
import { Link, router, usePage } from '@inertiajs/vue3';
import { computed, onMounted } from 'vue';
import AppLogo from '@/components/app/AppLogo.vue';
import UserAvatar from '@/components/display/UserAvatar.vue';
import { Badge } from '@/components/ui/badge';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from '@/components/ui/sidebar';
import { useCurrentUrl } from '@/composables/useCurrentUrl';
import { useI18n } from '@/composables/useI18n';
import { usePermissions } from '@/composables/usePermissions';
import { adminNav, visibleNav } from '@/lib/adminNav';
import { ICONS } from '@/lib/icons';
import { dashboard } from '@/routes/admin';
import type { NavItem } from '@/types';

// 15 §7.2: the admin sidebar, collapsible to icons on desktop and an offcanvas
// sheet below 1024 px. Items are hidden unless the user has one of their
// permissions or owner gates; the footer shows who is signed in.
const { t } = useI18n();
const page = usePage();
const { can } = usePermissions();
const { isCurrentUrl, isCurrentOrParentUrl } = useCurrentUrl();

const groups = computed(() => visibleNav(adminNav, can));
const user = computed(() => page.props.auth?.user ?? null);
const role = computed(() => user.value?.roles?.[0] ?? null);
const needsCounters = computed(() =>
    groups.value.some((group) => group.items.some((item) => item.counter)),
);

function isActive(item: NavItem): boolean {
    return item.exact
        ? isCurrentUrl(item.href)
        : isCurrentOrParentUrl(item.href);
}

function counterOf(item: NavItem): number {
    return item.counter ? (page.props.staffCounters?.[item.counter] ?? 0) : 0;
}

// `staffCounters` is an optional prop (11 §4): it is only sent when asked for.
onMounted(() => {
    if (needsCounters.value && page.props.staffCounters === undefined) {
        router.reload({ only: ['staffCounters'] });
    }
});
</script>

<template>
    <Sidebar collapsible="icon" data-test="admin-sidebar">
        <SidebarHeader>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" as-child>
                        <Link :href="dashboard()">
                            <AppLogo />
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
            <SidebarGroup v-for="group in groups" :key="group.key">
                <SidebarGroupLabel v-if="group.labelKey">{{
                    t(group.labelKey)
                }}</SidebarGroupLabel>
                <SidebarMenu>
                    <SidebarMenuItem
                        v-for="item in group.items"
                        :key="item.key"
                    >
                        <SidebarMenuButton
                            as-child
                            :is-active="isActive(item)"
                            :tooltip="t(item.labelKey)"
                            class="min-h-11 lg:min-h-8"
                        >
                            <Link
                                :href="item.href"
                                :aria-current="
                                    isActive(item) ? 'page' : undefined
                                "
                            >
                                <component
                                    :is="ICONS[item.icon]"
                                    aria-hidden="true"
                                />
                                <span>{{ t(item.labelKey) }}</span>
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuBadge v-if="counterOf(item) > 0">{{
                            counterOf(item)
                        }}</SidebarMenuBadge>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarGroup>
        </SidebarContent>

        <SidebarFooter v-if="user">
            <div class="flex items-center gap-2 p-1" data-test="sidebar-user">
                <UserAvatar :user="user" size="sm" />
                <div
                    class="grid min-w-0 flex-1 gap-0.5 text-sm group-data-[collapsible=icon]:hidden"
                >
                    <span class="truncate font-medium">{{ user.name }}</span>
                    <Badge v-if="role" variant="neutral" class="w-fit">{{
                        t(`roles.names.${role}`)
                    }}</Badge>
                </div>
            </div>
        </SidebarFooter>
        <SidebarRail />
    </Sidebar>
</template>
