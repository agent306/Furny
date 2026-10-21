<script setup lang="ts">
import { Form, Head, usePage } from '@inertiajs/vue3';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import TermsCheckbox from '@/components/auth/TermsCheckbox.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { complete } from '@/routes/auth/otp';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.4, 13 §5.2: step 3, for a number that was verified and has no account yet. The name and the terms; the
// verified number is in the session for 15 minutes.
defineProps<{
    maskedPhone: string;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
    canRegister?: boolean;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
const page = usePage();
// Too many sign-ups: the wait is counted down here, not shown as a toast (10 §4).
const { remaining } = useThrottleCountdown(() => page.props.errors);
</script>

<template>
    <Head :title="t('auth_ui.complete.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.complete.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.complete.description', { phone: maskedPhone }) }}
            </p>
        </div>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Form
            v-slot="{ errors, processing }"
            v-bind="complete.form()"
            class="flex flex-col gap-5"
            @error="focusFirstError"
        >
            <div class="grid gap-2">
                <Label for="name"
                    >{{ t('auth_ui.complete.name') }} <RequiredMark
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

            <TermsCheckbox :error="errors.terms" />

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="processing || remaining > 0"
                data-test="complete-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.complete.submit') }}
            </Button>
        </Form>
    </div>
</template>
