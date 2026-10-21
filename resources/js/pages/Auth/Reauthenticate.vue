<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import GoogleButton from '@/components/auth/GoogleButton.vue';
import OtpCodeField from '@/components/auth/OtpCodeField.vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { store } from '@/routes/auth/reauthenticate';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.8, 13 §6.4: for a user who has no password to confirm. A code to their verified phone, or Google. Success
// returns to the page they were sent away from.
const props = defineProps<{
    maskedPhone: string | null;
    phoneAvailable: boolean;
    googleLinked: boolean;
    googleEnabled: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
    canRegister?: boolean;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
const page = usePage();
const errors = computed(() => page.props.errors ?? {});
// Too many codes or tries: the wait is counted down here, not shown as a toast (10 §4).
const { remaining } = useThrottleCountdown(() => page.props.errors);

const code = ref('');
const codeSent = ref(false);
const sending = ref(false);
const confirming = ref(false);

// A refusal to send is an error of the `phone` field; a wrong code one of `code`, which carries `reason` (14 §1.9).
const codeError = computed(() =>
    errors.value.reason ? errors.value.code : undefined,
);
const sendError = computed(() =>
    remaining.value > 0 || errors.value.reason ? undefined : errors.value.phone,
);
const canConfirmByGoogle = computed(
    () => props.googleEnabled && props.googleLinked,
);
const nothing = computed(
    () => !props.phoneAvailable && !canConfirmByGoogle.value,
);

function sendCode(): void {
    router.post(
        store.url(),
        { step: 'send' },
        {
            preserveScroll: true,
            onStart: () => (sending.value = true),
            onFinish: () => (sending.value = false),
            onSuccess: () => {
                codeSent.value = true;
            },
        },
    );
}

function confirm(typed: string): void {
    if (confirming.value || typed.length !== 6) {
        return;
    }

    router.post(
        store.url(),
        { step: 'verify', code: typed },
        {
            preserveScroll: true,
            onStart: () => (confirming.value = true),
            onFinish: () => (confirming.value = false),
            onError: () => {
                code.value = '';
                void focusFirstError();
            },
        },
    );
}
</script>

<template>
    <Head :title="t('auth_ui.reauth.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.reauth.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.reauth.description') }}
            </p>
        </div>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Alert v-if="nothing" variant="destructive" data-test="reauth-nothing">
            <AlertDescription>{{
                t('auth_ui.reauth.nothing')
            }}</AlertDescription>
        </Alert>

        <div v-if="phoneAvailable" class="grid gap-4" data-test="reauth-phone">
            <Button
                type="button"
                size="lg"
                :variant="codeSent ? 'secondary' : 'default'"
                class="w-full"
                :disabled="sending || remaining > 0"
                data-test="send-code-button"
                @click="sendCode"
            >
                <Spinner v-if="sending" />
                {{ t('auth_ui.reauth.send') }}
            </Button>
            <p
                v-if="maskedPhone"
                class="text-center text-sm text-muted-foreground"
                data-test="reauth-phone-hint"
            >
                {{ t('auth_ui.reauth.to_phone', { phone: maskedPhone }) }}
            </p>
            <InputError id="send-error" :message="sendError" />

            <form
                v-if="codeSent"
                class="grid gap-4"
                novalidate
                @submit.prevent="confirm(code)"
            >
                <div class="grid gap-2">
                    <Label for="code"
                        >{{ t('auth_ui.reauth.code') }} <RequiredMark
                    /></Label>
                    <OtpCodeField
                        id="code"
                        v-model="code"
                        :disabled="confirming"
                        :invalid="Boolean(codeError)"
                        :describedby="codeError ? 'code-error' : undefined"
                        @complete="confirm"
                    />
                    <InputError id="code-error" :message="codeError" />
                </div>
                <Button
                    type="submit"
                    size="lg"
                    class="w-full"
                    :disabled="confirming || code.length !== 6"
                    data-test="confirm-button"
                >
                    <Spinner v-if="confirming" />
                    {{ t('auth_ui.reauth.confirm') }}
                </Button>
            </form>
        </div>

        <GoogleButton
            v-if="canConfirmByGoogle"
            intent="reauthenticate"
            :separated="phoneAvailable"
        />
    </div>
</template>
