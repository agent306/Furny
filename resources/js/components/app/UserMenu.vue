<script setup lang="ts">
import { Link, router, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import ThemeMenuItems from '@/components/app/ThemeMenuItems.vue';
import UserAvatar from '@/components/display/UserAvatar.vue';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import { logout } from '@/routes';
import { profile as staffProfile } from '@/routes/admin/account';
import { profile as customerProfile } from '@/routes/customer/account';

// 15 §9.31: the account menu: who is signed in, the account link (customer: Account; staff: My account), the theme and
// log out. The Help link joins with the customer help page.
const { t } = useI18n();
const page = usePage();
const user = computed(() => page.props.auth?.user ?? null);
const isStaff = computed(() => user.value?.type === 'staff');
const accountHref = computed(() =>
    isStaff.value ? staffProfile.url() : customerProfile.url(),
);

// A fresh session must not see cached pages of the previous one.
function onLogout(): void {
    router.flushAll();
}
</script>

<template>
    <DropdownMenu v-if="user">
        <DropdownMenuTrigger
            class="inline-flex size-11 items-center justify-center rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:size-9"
            :aria-label="t('a11y.user_menu')"
            data-test="user-menu"
        >
            <UserAvatar :user="user" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-56">
            <DropdownMenuLabel class="font-normal">
                <p class="truncate text-sm font-medium">{{ user.name }}</p>
                <p
                    v-if="user.email"
                    class="truncate text-xs text-muted-foreground"
                >
                    {{ user.email }}
                </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem as-child class="min-h-11 lg:min-h-0">
                <Link
                    :href="accountHref"
                    class="w-full cursor-pointer"
                    data-test="account-link"
                >
                    <component
                        :is="ICONS.user"
                        class="size-4"
                        aria-hidden="true"
                    />
                    {{
                        t(
                            isStaff
                                ? 'common.nav.my_account'
                                : 'common.nav.account',
                        )
                    }}
                </Link>
            </DropdownMenuItem>
            <DropdownMenuSub>
                <DropdownMenuSubTrigger
                    class="min-h-11 lg:min-h-0"
                    data-test="theme-submenu"
                >
                    <component
                        :is="ICONS.sun"
                        class="size-4"
                        aria-hidden="true"
                    />
                    {{ t('common.theme.label') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                    <ThemeMenuItems />
                </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem as-child class="min-h-11 lg:min-h-0">
                <Link
                    :href="logout()"
                    as="button"
                    class="w-full cursor-pointer"
                    data-test="logout-button"
                    @click="onLogout"
                >
                    <component
                        :is="ICONS['log-out']"
                        class="size-4"
                        aria-hidden="true"
                    />
                    {{ t('common.actions.log_out') }}
                </Link>
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
</template>
