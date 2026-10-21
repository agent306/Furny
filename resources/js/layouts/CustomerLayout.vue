<script setup lang="ts">
import AppFooter from '@/components/app/AppFooter.vue';
import AppHeader from '@/components/app/AppHeader.vue';
import AppShell from '@/components/app/AppShell.vue';
import MobileTabBar from '@/components/app/MobileTabBar.vue';
import VerifyContactBanner from '@/components/common/VerifyContactBanner.vue';
import { useUnverifiedContact } from '@/composables/useUnverifiedContact';
import { customerNav } from '@/lib/customerNav';

// 15 §7.1: sticky header, optional breadcrumb and banner regions, `#main`, the
// footer (tablet and up) and the phone tab bar. Every page renders its own h1
// (PageHeader); the layout renders none, so there is one per page. The `#banner`
// region holds the verify-contact banner (10 §1.1) of a customer with neither a
// verified email nor a verified phone, above whatever banner the page adds.
const { unverified } = useUnverifiedContact();
</script>

<template>
    <AppShell variant="customer">
        <div class="flex min-h-dvh flex-col bg-background">
            <AppHeader variant="customer" :nav="customerNav" />

            <div
                v-if="$slots.breadcrumbs"
                class="mx-auto hidden w-full max-w-6xl px-4 pt-3 text-sm sm:px-6 md:block lg:px-8"
            >
                <slot name="breadcrumbs" />
            </div>
            <div
                v-if="unverified || $slots.banner"
                id="banner"
                class="mx-auto w-full max-w-6xl space-y-3 px-4 pt-3 sm:px-6 lg:px-8"
            >
                <VerifyContactBanner />
                <slot name="banner" />
            </div>

            <main
                id="main"
                tabindex="-1"
                class="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-24 outline-none sm:px-6 md:py-6 md:pb-6 lg:px-8 lg:py-8"
            >
                <slot />
            </main>

            <AppFooter class="hidden md:block" />
            <MobileTabBar :items="customerNav" />
        </div>
    </AppShell>
</template>
