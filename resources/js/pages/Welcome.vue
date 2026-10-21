<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import AuthLayout from '@/layouts/AuthLayout.vue';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { IconName } from '@/lib/icons';
import { login, register } from '@/routes';

// 10 §4.1: the public landing page, no marketing site.
defineOptions({
    layout: [AuthLayout, { variant: 'wide' }],
});

defineProps<{
    canRegister: boolean;
}>();

const { t } = useI18n();

const FEATURES: { icon: IconName; labelKey: string }[] = [
    { icon: 'scan-line', labelKey: 'auth_ui.welcome.features.plan' },
    { icon: 'armchair', labelKey: 'auth_ui.welcome.features.design' },
    { icon: 'package-check', labelKey: 'auth_ui.welcome.features.order' },
];
</script>

<template>
    <Head :title="t('auth_ui.welcome.title')" />
    <div class="space-y-8">
        <h1
            tabindex="-1"
            class="text-center text-3xl font-semibold tracking-tight text-balance outline-none sm:text-4xl"
        >
            {{ t('auth_ui.welcome.tagline') }}
        </h1>

        <ul class="space-y-3">
            <li
                v-for="feature in FEATURES"
                :key="feature.icon"
                class="flex items-center gap-4 rounded-lg border bg-background p-4"
            >
                <span
                    class="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-wood-subtle text-brand-wood"
                >
                    <component
                        :is="ICONS[feature.icon]"
                        class="size-6"
                        aria-hidden="true"
                    />
                </span>
                <span class="text-base">{{ t(feature.labelKey) }}</span>
            </li>
        </ul>

        <div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
                v-if="canRegister"
                as-child
                size="lg"
                class="w-full sm:w-auto"
            >
                <Link :href="register()">{{
                    t('auth_ui.welcome.create_account')
                }}</Link>
            </Button>
            <Button
                as-child
                variant="outline"
                size="lg"
                class="w-full sm:w-auto"
            >
                <Link :href="login()">{{ t('auth_ui.welcome.log_in') }}</Link>
            </Button>
        </div>
    </div>
</template>
