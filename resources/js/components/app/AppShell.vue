<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, onMounted, onScopeDispose, provide } from 'vue';
import ConfirmHost from '@/components/common/ConfirmHost.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { DENSITY_KEY } from '@/composables/useControlSize';
import type { Density } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { useRouteFocus } from '@/composables/useRouteFocus';
import { useTheme } from '@/composables/useTheme';
import { flashBridge } from '@/lib/flashToast';

// 15 §9.1, §7, §10.3: the wrapper every layout renders. It owns everything
// that exists once per page: density, the toaster and the flash bridge, the
// skip link, the offline banner, the global confirm dialog, tooltips, the
// theme and the focus/announcement after navigation.
const props = withDefaults(
    defineProps<{
        variant: 'customer' | 'admin';
        /**
         * The offline banner above the slot. A full-viewport layout (the editor)
         * turns it off and renders its own inside its box, so going offline
         * does not push the page and scroll it.
         */
        offlineBanner?: boolean;
    }>(),
    { offlineBanner: true },
);

const { t } = useI18n();
const page = usePage();
const { isPhone } = useBreakpoint();

useTheme();

// Comfortable (h-11 controls) for the customer app and on phones; compact
// (h-9) only for the admin from 768 px (15 §3.3).
const density = computed<Density>(() =>
    props.variant === 'customer' || isPhone.value ? 'comfortable' : 'compact',
);

provide(DENSITY_KEY, density);

// Flash messages are plain text for a toast, never HTML. They come from the
// native flash of the page (`Inertia::flash`), which Inertia announces once per
// response with the `flash` event and the history never stores, so Back does
// not replay it. The page's own flash is read once the shell has mounted, for
// a shell that mounts with the page (a toast made before the Toaster exists is
// lost); the bridge remembers each flash object, so the two sources and a
// remounted shell show it once.
onMounted(() => flashBridge.show(page.flash));
onScopeDispose(
    router.on('flash', (event) => flashBridge.show(event.detail.flash)),
);

const announcement = useRouteFocus(() => ({
    component: page.component,
    url: page.url,
}));
</script>

<template>
    <TooltipProvider :delay-duration="300">
        <a
            href="#main"
            class="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-background focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            data-test="skip-link"
            >{{ t('common.a11y.skip_to_content') }}</a
        >
        <OfflineBanner v-if="offlineBanner" />
        <slot />
        <div
            class="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-test="route-announcer"
        >
            {{ announcement }}
        </div>
        <Toaster
            rich-colors
            close-button
            :position="isPhone ? 'top-center' : 'bottom-right'"
            :visible-toasts="3"
            :container-aria-label="t('notifications.title')"
            :toast-options="{ closeButtonAriaLabel: t('common.actions.close') }"
        />
        <ConfirmHost />
    </TooltipProvider>
</template>
