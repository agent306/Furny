<script setup lang="ts">
import { Form, Head, usePage } from '@inertiajs/vue3';
import { ref } from 'vue';
import OtpCodeField from '@/components/auth/OtpCodeField.vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { store } from '@/routes/two-factor/login';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.7, 13 §5.10: staff with a confirmed second factor, after their password (or Google). A 6-digit code from the
// authenticator, or one of the recovery codes. Five tries a minute: the wait is counted down on the page.
defineProps<{
    features: FeatureFlags;
    turnstileSiteKey: string | null;
    canRegister: boolean;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
const page = usePage();
const { remaining } = useThrottleCountdown(() => page.props.errors);

const useRecovery = ref(false);
const code = ref('');

function toggle(clearErrors: () => void): void {
    useRecovery.value = !useRecovery.value;
    code.value = '';
    clearErrors();
}
</script>

<template>
    <Head :title="t('auth_ui.two_factor.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.two_factor.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{
                    useRecovery
                        ? t('auth_ui.two_factor.recovery_description')
                        : t('auth_ui.two_factor.description')
                }}
            </p>
        </div>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Form
            v-slot="{ errors, processing, clearErrors }"
            v-bind="store.form()"
            :reset-on-error="['recovery_code']"
            class="flex flex-col gap-5"
            @error="
                () => {
                    code = '';
                    void focusFirstError();
                }
            "
        >
            <div v-if="!useRecovery" class="grid gap-2">
                <Label for="code"
                    >{{ t('auth_ui.two_factor.code') }} <RequiredMark
                /></Label>
                <OtpCodeField
                    id="code"
                    v-model="code"
                    :disabled="processing"
                    :invalid="Boolean(errors.code)"
                    :describedby="errors.code ? 'code-error' : undefined"
                />
                <InputError id="code-error" :message="errors.code" />
            </div>

            <div v-else class="grid gap-2">
                <Label for="recovery_code"
                    >{{ t('auth_ui.two_factor.recovery_code') }} <RequiredMark
                /></Label>
                <Input
                    id="recovery_code"
                    name="recovery_code"
                    type="text"
                    size="lg"
                    required
                    aria-required="true"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck="false"
                    class="font-mono"
                    :aria-invalid="errors.recovery_code ? 'true' : undefined"
                    :aria-describedby="
                        errors.recovery_code ? 'recovery_code-error' : undefined
                    "
                />
                <InputError
                    id="recovery_code-error"
                    :message="errors.recovery_code"
                />
            </div>

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="processing || remaining > 0"
                data-test="challenge-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.two_factor.submit') }}
            </Button>

            <button
                type="button"
                class="inline-flex min-h-11 items-center justify-center text-sm text-foreground underline underline-offset-4"
                data-test="toggle-recovery"
                @click="toggle(clearErrors)"
            >
                {{
                    useRecovery
                        ? t('auth_ui.two_factor.use_code')
                        : t('auth_ui.two_factor.use_recovery')
                }}
            </button>
        </Form>

        <p
            class="text-center text-sm text-muted-foreground"
            data-test="lost-help"
        >
            {{ t('auth_ui.two_factor.lost_help') }}
        </p>
    </div>
</template>
