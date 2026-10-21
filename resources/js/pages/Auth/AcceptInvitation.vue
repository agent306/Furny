<script setup lang="ts">
import { Form, Head, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import GoogleButton from '@/components/auth/GoogleButton.vue';
import PasswordField from '@/components/auth/PasswordField.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { privacy, terms } from '@/routes/legal';

// 11 §7.1, 13 §5.9 step 3. The form posts to the page's own signed URL (`staff.invitations.accept` shares its path and
// its signature with this page); the email is the invited one and cannot be changed. The Google option leaves the page
// and comes back to it with `googleConnected` and the name Google gave (13 §5.9 step 4): the password is still needed.
const props = defineProps<{
    invitation: {
        email: string;
        name: string;
        roleLabel: string;
        expiresAt: string;
    };
    googleEnabled: boolean;
    prefillName: string | null;
    googleConnected: boolean;
    /** Laravel's `Password::defaults()` as password-manager rules, e.g. `minlength: 8; maxlength: 128;`. */
    passwordRules: string;
}>();

const { t } = useI18n();
const { formatDateTime } = useFormat();
const { focusFirstError } = useFocusFirstError();
const page = usePage();

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
    <Head :title="t('staff.accept.title', { appName: page.props.app.name })" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('staff.accept.title', { appName: page.props.app.name }) }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{
                    t('staff.accept.description', {
                        role: invitation.roleLabel,
                    })
                }}
            </p>
            <p
                class="text-xs text-muted-foreground"
                data-test="invitation-expiry"
            >
                {{
                    t('staff.accept.expires', {
                        date: formatDateTime(invitation.expiresAt),
                    })
                }}
            </p>
        </div>

        <Alert
            v-if="googleConnected"
            role="status"
            data-test="google-connected"
        >
            <AlertDescription>{{
                t('staff.accept.google_connected')
            }}</AlertDescription>
        </Alert>

        <Form
            v-slot="{ errors, processing }"
            :action="page.url"
            method="post"
            :reset-on-error="['password', 'password_confirmation']"
            class="flex flex-col gap-5"
            @error="focusFirstError"
        >
            <div class="grid gap-2">
                <Label for="email">{{ t('staff.accept.email') }}</Label>
                <Input
                    id="email"
                    type="email"
                    size="lg"
                    :model-value="invitation.email"
                    readonly
                    autocomplete="email"
                    :aria-invalid="errors.email ? 'true' : undefined"
                    :aria-describedby="errors.email ? 'email-error' : undefined"
                />
                <InputError id="email-error" :message="errors.email" />
            </div>

            <div class="grid gap-2">
                <Label for="name"
                    >{{ t('staff.accept.name') }} <RequiredMark
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
                    :default-value="prefillName ?? invitation.name"
                    :aria-invalid="errors.name ? 'true' : undefined"
                    :aria-describedby="errors.name ? 'name-error' : undefined"
                />
                <InputError id="name-error" :message="errors.name" />
            </div>

            <div class="grid gap-2">
                <Label for="password"
                    >{{ t('staff.accept.password') }} <RequiredMark
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
                    >{{ t('staff.accept.password_confirmation') }}
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
                data-test="accept-button"
            >
                <Spinner v-if="processing" />
                {{ t('staff.accept.submit') }}
            </Button>

            <p
                class="text-center text-xs leading-relaxed text-muted-foreground"
                data-test="terms-caption"
            >
                {{ t('staff.accept.terms_before') }}
                <a
                    :href="terms().url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline underline-offset-4"
                    >{{ t('legal.terms.title') }}</a
                >
                {{ t('staff.accept.terms_and') }}
                <a
                    :href="privacy().url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline underline-offset-4"
                    >{{ t('legal.privacy.title') }}</a
                >{{ t('staff.accept.terms_after') }}
            </p>
        </Form>

        <GoogleButton
            v-if="googleEnabled && !googleConnected"
            intent="invitation"
            separated
        />
    </div>
</template>
