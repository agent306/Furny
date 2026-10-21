<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { computed, ref, useTemplateRef } from 'vue';
import OtpCodeField from '@/components/auth/OtpCodeField.vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import TurnstileWidget from '@/components/auth/TurnstileWidget.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useCountdown } from '@/composables/useCountdown';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useOtpStatusPoll } from '@/composables/useOtpStatusPoll';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { create, resend, verify } from '@/routes/auth/otp';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.4, 13 §4.4: step 2. One code field that submits itself at six digits, the channel and the masked number, a
// 60 s wait before the code can be asked for again, and while the code went by WhatsApp a poll that notices when it
// was replaced by an SMS (13 §4.2).
const props = defineProps<{
    channel: 'whatsapp' | 'sms';
    maskedPhone: string;
    resendAvailableIn: number;
    channels: ('whatsapp' | 'sms')[];
    features: FeatureFlags;
    turnstileSiteKey: string | null;
    canRegister?: boolean;
}>();

const { t } = useI18n();
const page = usePage();
const errors = computed(() => page.props.errors ?? {});
// Too many tries: the wait is counted down here, not shown as a toast (10 §4).
const { remaining: throttled } = useThrottleCountdown(() => page.props.errors);
const { remaining: resendIn } = useCountdown(() => props.resendAvailableIn);
const { focusFirstError } = useFocusFirstError();
const turnstile =
    useTemplateRef<InstanceType<typeof TurnstileWidget>>('turnstile');

const code = ref('');
const submitting = ref(false);
const resending = ref(false);
const needsCaptcha = ref(false);

// An error of the code field carries its machine code as `reason`; without one `code` is the machine code of a
// refusal of the resend (14 §1.9), and the message is `phone`.
const codeError = computed(() =>
    errors.value.reason ? errors.value.code : undefined,
);
const resendError = computed(() =>
    throttled.value > 0 || errors.value.reason ? undefined : errors.value.phone,
);

const { fallbackSent } = useOtpStatusPoll(
    () => props.channel === 'whatsapp',
    () => router.reload(),
);

function submit(typed: string): void {
    if (submitting.value || typed.length !== 6) {
        return;
    }

    router.post(
        verify.url(),
        { code: typed },
        {
            preserveScroll: true,
            onStart: () => (submitting.value = true),
            onFinish: () => (submitting.value = false),
            // A wrong code is typed over.
            onError: () => {
                code.value = '';
                void focusFirstError();
            },
        },
    );
}

function resendBy(channel: 'whatsapp' | 'sms'): void {
    const token = document.querySelector<HTMLInputElement>(
        'input[name="cf_turnstile_response"]',
    )?.value;

    router.post(
        resend.url(),
        { channel, ...(token ? { cf_turnstile_response: token } : {}) },
        {
            preserveScroll: true,
            onStart: () => (resending.value = true),
            onFinish: () => {
                resending.value = false;
                turnstile.value?.reset();
            },
            onSuccess: () => {
                code.value = '';
            },
            onError: (failed) => {
                needsCaptcha.value =
                    needsCaptcha.value || failed.code === 'captcha_required';
            },
        },
    );
}

const resendChannels = computed(() =>
    props.channels.length > 0 ? props.channels : [props.channel],
);
const waiting = computed(
    () => resendIn.value > 0 || throttled.value > 0 || resending.value,
);
</script>

<template>
    <Head :title="t('auth_ui.otp.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.otp.title') }}
            </h1>
            <p class="text-sm text-muted-foreground" data-test="otp-sent">
                {{ t('auth_ui.otp.sent', { phone: maskedPhone, channel }) }}
            </p>
        </div>

        <Alert v-if="fallbackSent" role="status" data-test="otp-fallback">
            <AlertDescription>{{ t('auth_ui.otp.fallback') }}</AlertDescription>
        </Alert>

        <ThrottleNotice v-if="throttled > 0" :seconds="throttled" />

        <form
            class="flex flex-col gap-5"
            novalidate
            @submit.prevent="submit(code)"
        >
            <div class="grid gap-2">
                <Label for="code"
                    >{{ t('auth_ui.otp.code') }} <RequiredMark
                /></Label>
                <OtpCodeField
                    id="code"
                    v-model="code"
                    :disabled="submitting"
                    :invalid="Boolean(codeError)"
                    :describedby="codeError ? 'code-error' : undefined"
                    @complete="submit"
                />
                <InputError id="code-error" :message="codeError" />
            </div>

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="submitting || code.length !== 6 || throttled > 0"
                data-test="verify-button"
            >
                <Spinner v-if="submitting" />
                {{ t('auth_ui.otp.verify') }}
            </Button>
        </form>

        <div class="grid gap-3">
            <div v-if="needsCaptcha" class="grid gap-2">
                <TurnstileWidget
                    ref="turnstile"
                    :site-key="turnstileSiteKey"
                    action="otp_send"
                />
                <InputError
                    id="captcha-error"
                    :message="errors.cf_turnstile_response"
                />
            </div>

            <InputError id="resend-error" :message="resendError" />

            <p
                v-if="resendIn > 0"
                class="text-center text-sm text-muted-foreground"
                data-test="resend-wait"
            >
                {{ t('auth_ui.otp.resend_in', { seconds: resendIn }) }}
            </p>

            <div class="flex flex-col gap-2 sm:flex-row">
                <Button
                    v-for="option in resendChannels"
                    :key="option"
                    type="button"
                    variant="secondary"
                    size="lg"
                    class="flex-1"
                    :disabled="waiting"
                    :data-test="`resend-${option}`"
                    @click="resendBy(option)"
                >
                    {{
                        option === 'whatsapp'
                            ? t('auth_ui.otp.resend_whatsapp')
                            : t('auth_ui.otp.resend_sms')
                    }}
                </Button>
            </div>
        </div>

        <p class="text-center text-sm">
            <Link
                :href="create()"
                class="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
                data-test="change-number"
            >
                {{ t('auth_ui.otp.change_number') }}
            </Link>
        </p>
    </div>
</template>
