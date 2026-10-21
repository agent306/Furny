<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AppHeader from '@/components/app/AppHeader.vue';
import AppShell from '@/components/app/AppShell.vue';
import AppSidebar from '@/components/app/AppSidebar.vue';
import { Button } from '@/components/ui/button';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { BreadcrumbItem } from '@/types';

// 15 §7.2: sidebar + sticky top bar + `#main`. `breadcrumbs` comes from a
// page's `defineOptions({ layout: { breadcrumbs } })`. The sidebar remembers
// its open state in the `sidebar_state` cookie, which the SidebarProvider reads
// and writes in the browser; the server never needs it.
withDefaults(
    defineProps<{
        breadcrumbs?: BreadcrumbItem[];
    }>(),
    { breadcrumbs: () => [] },
);

const { t } = useI18n();
const page = usePage();
// Health banners (11 §4) can be dismissed for the rest of the visit.
const dismissed = ref<string[]>([]);
const banners = computed(() =>
    (page.props.healthBanners ?? []).filter(
        (banner) => !dismissed.value.includes(banner.key),
    ),
);
</script>

<template>
    <AppShell variant="admin">
        <SidebarProvider>
            <AppSidebar />
            <div class="flex min-w-0 flex-1 flex-col">
                <AppHeader variant="admin" :breadcrumbs="breadcrumbs" />

                <div
                    v-if="banners.length > 0 || $slots.banner"
                    id="banner"
                    class="space-y-2 px-4 pt-3 lg:px-6"
                >
                    <div
                        v-for="banner in banners"
                        :key="banner.key"
                        role="status"
                        data-test="health-banner"
                        class="flex items-center gap-2 rounded-lg bg-warning-subtle px-4 py-2 text-sm text-warning-subtle-foreground"
                    >
                        <p class="min-w-0 flex-1">{{ t(banner.messageKey) }}</p>
                        <Button
                            variant="ghost"
                            size="icon-lg"
                            class="shrink-0 lg:size-8"
                            :aria-label="t('common.actions.close')"
                            @click="dismissed.push(banner.key)"
                        >
                            <component
                                :is="ICONS['x-circle']"
                                class="size-4"
                                aria-hidden="true"
                            />
                        </Button>
                    </div>
                    <slot name="banner" />
                </div>

                <main
                    id="main"
                    tabindex="-1"
                    class="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 outline-none md:py-6 lg:px-6"
                >
                    <slot />
                </main>
            </div>
        </SidebarProvider>
    </AppShell>
</template>
