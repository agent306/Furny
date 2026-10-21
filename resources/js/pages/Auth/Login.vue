<script setup lang="ts">
import { Form, Head, Link, usePage } from '@inertiajs/vue3';
import GoogleButton from '@/components/auth/GoogleButton.vue';
import PasswordField from '@/components/auth/PasswordField.vue';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';
import { register } from '@/routes';
import { store } from '@/routes/login';
import { request } from '@/routes/password';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.2. The phone sign-in button is added with that sign-in method.
defineProps<{
    status?: string | null;
    canResetPassword: boolean;
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
// Too many attempts: the wait is counted down here, not shown as a toast (10 §4).
const page = usePage();
const { remaining } = useThrottleCountdown(() => page.props.errors);
</script>

<template>
    <Head :title="t('auth_ui.login.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.login.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.login.description') }}
            </p>
        </div>

        <Alert v-if="status" role="status" data-test="login-status">
            <AlertDescription>{{ status }}</AlertDescription>
        </Alert>

        <ThrottleNotice v-if="remaining > 0" :seconds="remaining" />

        <Form
            v-slot="{ errors, processing }"
            v-bind="store.form()"
            :reset-on-error="['password']"
            class="flex flex-col gap-5"
            @error="focusFirstError"
        >
            <div class="grid gap-2">
                <Label for="email"
                    >{{ t('auth_ui.login.email') }} <RequiredMark
                /></Label>
                <Input
                    id="email"
                    name="email"
                    type="email"
                    size="lg"
                    required
                    aria-required="true"
                    autocomplete="username"
                    :aria-invalid="errors.email ? 'true' : undefined"
                    :aria-describedby="errors.email ? 'email-error' : undefined"
                />
                <InputError id="email-error" :message="errors.email" />
            </div>

            <div class="grid gap-2">
                <div class="flex items-center justify-between gap-2">
                    <Label for="password"
                        >{{ t('auth_ui.login.password') }} <RequiredMark
                    /></Label>
                    <Link
                        v-if="canResetPassword"
                        :href="request()"
                        class="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                    >
                        {{ t('auth_ui.login.forgot_password') }}
                    </Link>
                </div>
                <PasswordField
                    id="password"
                    name="password"
                    size="lg"
                    required
                    aria-required="true"
                    autocomplete="current-password"
                    :aria-invalid="errors.password ? 'true' : undefined"
                    :aria-describedby="
                        errors.password ? 'password-error' : undefined
                    "
                />
                <InputError id="password-error" :message="errors.password" />
            </div>

            <div class="flex min-h-11 items-center gap-3">
                <Checkbox id="remember" name="remember" :default-value="true" />
                <Label for="remember" class="font-normal">{{
                    t('auth_ui.login.remember')
                }}</Label>
            </div>

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="processing || remaining > 0"
                data-test="login-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.login.submit') }}
            </Button>
        </Form>

        <GoogleButton separated />

        <p v-if="canRegister" class="text-center text-sm text-muted-foreground">
            {{ t('auth_ui.login.new_here') }}
            <Link
                :href="register()"
                class="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
            >
                {{ t('auth_ui.login.create_account') }}
            </Link>
        </p>
    </div>
</template>
