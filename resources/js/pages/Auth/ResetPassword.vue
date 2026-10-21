<script setup lang="ts">
import { Form, Head, Link } from '@inertiajs/vue3';
import { computed } from 'vue';
import PasswordField from '@/components/auth/PasswordField.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { request, update } from '@/routes/password';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.5. The email and the token come from the link; the email is shown, not editable. A token that is used up
// or too old comes back as an error of the email field, with the way to ask for a new link.
const props = defineProps<{
    email: string;
    token: string;
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
    /** Laravel's `Password::defaults()` as password-manager rules, e.g. `minlength: 8; maxlength: 128;`. */
    passwordRules: string;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();

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
    <Head :title="t('auth_ui.reset.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.reset.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.reset.description') }}
            </p>
        </div>

        <Form
            v-slot="{ errors, processing }"
            v-bind="update.form()"
            :transform="(data) => ({ ...data, token, email })"
            :reset-on-error="['password', 'password_confirmation']"
            class="flex flex-col gap-5"
            @error="focusFirstError"
        >
            <div class="grid gap-2">
                <Label for="email">{{ t('auth_ui.reset.email') }}</Label>
                <Input
                    id="email"
                    name="email"
                    type="email"
                    size="lg"
                    readonly
                    autocomplete="username"
                    :default-value="email"
                    :aria-invalid="errors.email ? 'true' : undefined"
                    :aria-describedby="errors.email ? 'email-error' : undefined"
                />
                <InputError id="email-error" :message="errors.email" />
                <Link
                    v-if="errors.email"
                    :href="request()"
                    class="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                    data-test="request-new-link"
                >
                    {{ t('auth_ui.reset.request_new') }}
                </Link>
            </div>

            <div class="grid gap-2">
                <Label for="password"
                    >{{ t('auth_ui.reset.password') }} <RequiredMark
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
                    >{{ t('auth_ui.reset.password_confirmation') }}
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

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="processing"
                data-test="reset-password-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.reset.submit') }}
            </Button>
        </Form>
    </div>
</template>
