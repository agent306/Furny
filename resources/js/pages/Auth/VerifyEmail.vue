<script setup lang="ts">
import { Form, Head, Link, router, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { logout } from '@/routes';
import { dashboard as adminDashboard } from '@/routes/admin';
import { dashboard as customerDashboard } from '@/routes/customer';
import { send } from '@/routes/verification';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.6. The app works without a verified address (10 §1.1), so the way on is always there.
defineProps<{
    status?: string | null;
    email: string;
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
}>();

const { t } = useI18n();
// Too many resends: the wait is counted down here, not shown as a toast (10 §4).
const page = usePage();
const { remaining } = useThrottleCountdown(() => page.props.errors);

const home = computed(() =>
    page.props.auth?.user?.type === 'staff'
        ? adminDashboard()
        : customerDashboard(),
);

// A fresh session must not see cached pages of the previous one.
function onLogout(): void {
    router.flushAll();
}
</script>

<template>
    <Head :title="t('auth_ui.verify.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.verify.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.verify.description', { email }) }}
            </p>
        </div>

        <Alert
            v-if="status === 'verification-link-sent'"
            role="status"
            data-test="verify-status"
        >
            <AlertDescription>{{
                t('auth_ui.verify.resent', { email })
            }}</AlertDescription>
        </Alert>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Form
            v-slot="{ processing }"
            v-bind="send.form()"
            class="flex flex-col gap-3"
        >
            <Button
                type="submit"
                size="lg"
                variant="secondary"
                class="w-full"
                :disabled="processing || remaining > 0"
                data-test="resend-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.verify.resend') }}
            </Button>
        </Form>

        <div class="flex flex-col items-center gap-1 text-sm">
            <Link
                :href="home"
                class="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
                data-test="continue-link"
            >
                {{ t('auth_ui.verify.continue') }}
            </Link>
            <Link
                :href="logout()"
                as="button"
                class="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground underline underline-offset-4"
                data-test="logout-button"
                @click="onLogout"
            >
                {{ t('common.actions.log_out') }}
            </Link>
        </div>
    </div>
</template>
