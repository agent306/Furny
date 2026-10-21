<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { MailWarning } from '@lucide/vue';
import { computed, ref } from 'vue';
import { toast } from 'vue-sonner';
import PhoneVerifyDialog from '@/components/account/PhoneVerifyDialog.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/composables/useI18n';
import { useUnverifiedContact } from '@/composables/useUnverifiedContact';
import { send } from '@/routes/verification';

// 10 §1.1, 15 §9.31: "Verify your email or phone to send orders and messages." for a customer with neither verified,
// with a button to resend the email link (only when there is an email) and one to verify the phone in the dialog.
// The resend posts to `verification.send` like the verify page does, but from any customer page, where there is no
// countdown to show a wait in: it asks for the toast with `X-Throttle-Toast` (RateLimitedResponse::TOAST_HEADER).
const TOAST_HEADER = 'X-Throttle-Toast';

const { t } = useI18n();
const page = usePage();
const { unverified } = useUnverifiedContact();

const hasEmail = computed(() => Boolean(page.props.auth?.user?.email));
const phone = computed(() => page.props.auth?.user?.phoneE164 ?? null);
const dialogOpen = ref(false);
const sending = ref(false);

function resend(): void {
    router.post(
        send.url(),
        {},
        {
            headers: { [TOAST_HEADER]: '1' },
            preserveScroll: true,
            preserveState: true,
            onStart: () => (sending.value = true),
            onFinish: () => (sending.value = false),
            // A refused resend (429) comes back as an error toast by the response itself; only a sent link is
            // announced here.
            onSuccess: (visited) => {
                if (!visited.flash?.error) {
                    toast.success(t('common.verify_banner.email_sent'));
                }
            },
        },
    );
}
</script>

<template>
    <Alert v-if="unverified" role="status" data-test="verify-contact-banner">
        <MailWarning aria-hidden="true" />
        <AlertDescription class="space-y-2">
            <p>{{ t('common.verify_banner.message') }}</p>
            <div class="flex flex-wrap gap-2">
                <Button
                    v-if="hasEmail"
                    type="button"
                    variant="outline"
                    size="sm"
                    :disabled="sending"
                    data-test="resend-email"
                    @click="resend"
                >
                    <Spinner v-if="sending" />
                    {{ t('common.verify_banner.resend_email') }}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-test="verify-phone"
                    @click="dialogOpen = true"
                >
                    {{ t('common.verify_banner.verify_phone') }}
                </Button>
            </div>
        </AlertDescription>
    </Alert>

    <PhoneVerifyDialog
        v-if="unverified"
        v-model:open="dialogOpen"
        :initial-phone="phone"
    />
</template>
