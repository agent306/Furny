<script setup lang="ts">
import { Form, Head, Link, usePage } from '@inertiajs/vue3';
import { computed, ref, useTemplateRef } from 'vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import TurnstileWidget from '@/components/auth/TurnstileWidget.vue';
import TermsCheckbox from '@/components/auth/TermsCheckbox.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import PhoneInput from '@/components/inputs/PhoneInput.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { login, register } from '@/routes';
import { send } from '@/routes/auth/otp';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.4, 13 §5.2: step 1. The same form signs in and signs up: `intent=register` adds the name and the terms. The
// Turnstile widget appears when the server asks for it (422 `captcha_required`, after two sends, 13 §4.2).
const props = defineProps<{
    intent: 'login' | 'register';
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
const page = usePage();
// Too many codes asked for: the wait is counted down here, not shown as a toast (10 §4).
const { remaining } = useThrottleCountdown(() => page.props.errors);
const turnstile =
    useTemplateRef<InstanceType<typeof TurnstileWidget>>('turnstile');

const phone = ref<string | null>(null);
const needsCaptcha = ref(false);
const registering = computed(() => props.intent === 'register');

// The refusals of the send are errors of the `phone` field, with the machine code under `code` (14 §1.9).
function onError(errors: Record<string, string>): void {
    needsCaptcha.value =
        needsCaptcha.value || errors.code === 'captcha_required';
    turnstile.value?.reset();
    void focusFirstError();
}
</script>

<template>
    <Head :title="t('auth_ui.phone.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{
                    registering
                        ? t('auth_ui.phone.title_register')
                        : t('auth_ui.phone.title')
                }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.phone.description') }}
            </p>
        </div>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Form
            v-slot="{ errors, processing }"
            v-bind="send.form()"
            class="flex flex-col gap-5"
            @error="onError"
        >
            <input type="hidden" name="intent" :value="intent" />

            <div v-if="registering" class="grid gap-2">
                <Label for="name"
                    >{{ t('auth_ui.phone.name') }} <RequiredMark
                /></Label>
                <Input
                    id="name"
                    name="name"
                    type="text"
                    size="lg"
                    required
                    aria-required="true"
                    minlength="2"
                    maxlength="120"
                    autocomplete="name"
                    :aria-invalid="errors.name ? 'true' : undefined"
                    :aria-describedby="errors.name ? 'name-error' : undefined"
                />
                <InputError id="name-error" :message="errors.name" />
            </div>

            <div class="grid gap-2">
                <Label for="phone"
                    >{{ t('auth_ui.phone.number') }} <RequiredMark
                /></Label>
                <PhoneInput
                    id="phone"
                    v-model="phone"
                    aria-required="true"
                    :invalid="Boolean(errors.phone) && remaining === 0"
                    :aria-describedby="
                        errors.phone && remaining === 0
                            ? 'phone-error'
                            : undefined
                    "
                />
                <input type="hidden" name="phone" :value="phone ?? ''" />
                <InputError
                    id="phone-error"
                    :message="remaining === 0 ? errors.phone : undefined"
                />
            </div>

            <TermsCheckbox v-if="registering" :error="errors.terms" />

            <div v-if="needsCaptcha" class="grid gap-2">
                <TurnstileWidget
                    ref="turnstile"
                    :site-key="turnstileSiteKey"
                    action="otp_send"
                    :aria-invalid="
                        errors.cf_turnstile_response ? 'true' : undefined
                    "
                    :aria-describedby="
                        errors.cf_turnstile_response
                            ? 'captcha-error'
                            : undefined
                    "
                />
                <InputError
                    id="captcha-error"
                    :message="errors.cf_turnstile_response"
                />
            </div>

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="processing || remaining > 0"
                data-test="send-code-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.phone.send') }}
            </Button>
        </Form>

        <p class="text-center text-sm">
            <Link
                :href="registering ? register() : login()"
                class="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
                data-test="use-email-link"
            >
                {{ t('auth_ui.phone.use_email') }}
            </Link>
        </p>
    </div>
</template>
