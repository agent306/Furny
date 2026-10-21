<script setup lang="ts">
import { Form, Head, Link, usePage } from '@inertiajs/vue3';
import { computed, useTemplateRef } from 'vue';
import PasswordField from '@/components/auth/PasswordField.vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import TurnstileWidget from '@/components/auth/TurnstileWidget.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { login } from '@/routes';
import { privacy, terms } from '@/routes/legal';
import { store } from '@/routes/register';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.3. The phone and Google sign-up buttons are added with those sign-in methods.
const props = defineProps<{
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
    /** Laravel's `Password::defaults()` as password-manager rules, e.g. `minlength: 8; maxlength: 128;`. */
    passwordRules: string;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
// Too many attempts: the wait is counted down here, not shown as a toast (10 §4).
const page = usePage();
const { remaining } = useThrottleCountdown(() => page.props.errors);
const turnstile =
    useTemplateRef<InstanceType<typeof TurnstileWidget>>('turnstile');

/** A new token is needed after a failed submit, and the first invalid field gets the focus (15 §10.1). */
function onError(): void {
    turnstile.value?.reset();
    void focusFirstError();
}

const minLength = computed(() => {
    const match = /minlength:\s*(\d+)/.exec(props.passwordRules);

    return match?.[1] === undefined ? null : Number(match[1]);
});

/** The ids that describe the password field: its error, and the hint when there is one. */
function describedBy(error: string | undefined): string | undefined {
    const ids = [
        error ? 'password-error' : null,
        minLength.value === null ? null : 'password-hint',
    ].filter((id) => id !== null);

    return ids.length === 0 ? undefined : ids.join(' ');
}
</script>

<template>
    <Head :title="t('auth_ui.register.title')" />

    <p
        v-if="!canRegister"
        class="text-center text-sm text-muted-foreground"
        data-test="registration-closed"
    >
        {{ t('auth_ui.registration_closed') }}
    </p>

    <div v-else class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.register.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.register.description') }}
            </p>
        </div>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Form
            v-slot="{ errors, processing }"
            v-bind="store.form()"
            :reset-on-error="['password', 'password_confirmation']"
            class="flex flex-col gap-5"
            @error="onError"
        >
            <div class="grid gap-2">
                <Label for="name"
                    >{{ t('auth_ui.register.name') }} <RequiredMark
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
                <Label for="email"
                    >{{ t('auth_ui.register.email') }} <RequiredMark
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
                <Label for="password"
                    >{{ t('auth_ui.register.password') }} <RequiredMark
                /></Label>
                <PasswordField
                    id="password"
                    name="password"
                    size="lg"
                    required
                    aria-required="true"
                    autocomplete="new-password"
                    :passwordrules="passwordRules"
                    :aria-invalid="errors.password ? 'true' : undefined"
                    :aria-describedby="describedBy(errors.password)"
                />
                <p
                    v-if="minLength !== null"
                    id="password-hint"
                    class="text-sm text-muted-foreground"
                >
                    {{ t('auth_ui.password_rules', { min: minLength }) }}
                </p>
                <InputError id="password-error" :message="errors.password" />
            </div>

            <div class="grid gap-2">
                <Label for="password_confirmation"
                    >{{ t('auth_ui.register.password_confirmation') }}
                    <RequiredMark
                /></Label>
                <PasswordField
                    id="password_confirmation"
                    name="password_confirmation"
                    size="lg"
                    required
                    aria-required="true"
                    autocomplete="new-password"
                    :passwordrules="passwordRules"
                />
            </div>

            <div class="grid gap-2">
                <div class="flex items-start gap-3">
                    <Checkbox
                        id="terms"
                        name="terms"
                        class="mt-0.5"
                        :aria-invalid="errors.terms ? 'true' : undefined"
                        :aria-describedby="
                            errors.terms ? 'terms-error' : undefined
                        "
                    />
                    <Label
                        for="terms"
                        class="block text-sm leading-relaxed font-normal"
                    >
                        {{ t('auth_ui.register.terms_before') }}
                        <a
                            :href="terms().url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline underline-offset-4"
                            >{{ t('legal.terms.title') }}</a
                        >
                        {{ t('auth_ui.register.terms_and') }}
                        <a
                            :href="privacy().url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline underline-offset-4"
                            >{{ t('legal.privacy.title') }}</a
                        >
                        <RequiredMark />
                    </Label>
                </div>
                <InputError id="terms-error" :message="errors.terms" />
            </div>

            <div class="flex items-start gap-3">
                <Checkbox
                    id="marketing_opt_in"
                    name="marketing_opt_in"
                    class="mt-0.5"
                />
                <Label
                    for="marketing_opt_in"
                    class="block text-sm leading-relaxed font-normal"
                >
                    {{ t('auth_ui.register.marketing_opt_in') }}
                </Label>
            </div>

            <div class="grid gap-2">
                <TurnstileWidget
                    ref="turnstile"
                    :site-key="turnstileSiteKey"
                    action="register"
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
                data-test="register-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.register.submit') }}
            </Button>
        </Form>

        <p class="text-center text-sm text-muted-foreground">
            {{ t('auth_ui.register.have_account') }}
            <Link
                :href="login()"
                class="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
            >
                {{ t('auth_ui.register.log_in') }}
            </Link>
        </p>
    </div>
</template>
