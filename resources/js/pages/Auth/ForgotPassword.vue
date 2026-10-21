<script setup lang="ts">
import { Form, Head, Link } from '@inertiajs/vue3';
import { useTemplateRef } from 'vue';
import TurnstileWidget from '@/components/auth/TurnstileWidget.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { login } from '@/routes';
import { email } from '@/routes/password';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.5. The answer never says whether the address has an account, and the hourly limit is silent (13 §5.5), so
// this page has no wait to count down: it shows the one sentence the server sends as `status`.
defineProps<{
    status?: string | null;
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
const turnstile =
    useTemplateRef<InstanceType<typeof TurnstileWidget>>('turnstile');

/** A new token is needed after a failed submit, and the first invalid field gets the focus (15 §10.1). */
function onError(): void {
    turnstile.value?.reset();
    void focusFirstError();
}

/** A token works once, so the widget asks for another one after every answer. */
function onSuccess(): void {
    turnstile.value?.reset();
}
</script>

<template>
    <Head :title="t('auth_ui.forgot.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.forgot.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.forgot.description') }}
            </p>
        </div>

        <Alert v-if="status" role="status" data-test="forgot-status">
            <AlertDescription>{{ status }}</AlertDescription>
        </Alert>

        <Form
            v-slot="{ errors, processing }"
            v-bind="email.form()"
            reset-on-success
            class="flex flex-col gap-5"
            @error="onError"
            @success="onSuccess"
        >
            <div class="grid gap-2">
                <Label for="email"
                    >{{ t('auth_ui.forgot.email') }} <RequiredMark
                /></Label>
                <Input
                    id="email"
                    name="email"
                    type="email"
                    size="lg"
                    required
                    aria-required="true"
                    autocomplete="email"
                    :aria-invalid="errors.email ? 'true' : undefined"
                    :aria-describedby="errors.email ? 'email-error' : undefined"
                />
                <InputError id="email-error" :message="errors.email" />
            </div>

            <div class="grid gap-2">
                <TurnstileWidget
                    ref="turnstile"
                    :site-key="turnstileSiteKey"
                    action="password_reset"
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
                :disabled="processing"
                data-test="forgot-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.forgot.submit') }}
            </Button>
        </Form>

        <p class="text-center text-sm">
            <Link
                :href="login()"
                class="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
            >
                {{ t('auth_ui.forgot.back_to_login') }}
            </Link>
        </p>
    </div>
</template>
