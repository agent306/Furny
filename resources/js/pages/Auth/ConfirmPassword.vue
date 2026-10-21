<script setup lang="ts">
import { Form, Head } from '@inertiajs/vue3';
import PasswordField from '@/components/auth/PasswordField.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { store } from '@/routes/password/confirm';
import type { FeatureFlags } from '@/types/inertia';

// 10 §4.8. Where a sensitive action sends a user who has not signed in or confirmed lately (13 §6.4); on success
// the user goes back to the page they came from.
defineProps<{
    canRegister: boolean;
    features: FeatureFlags;
    turnstileSiteKey: string | null;
}>();

const { t } = useI18n();
const { focusFirstError } = useFocusFirstError();
</script>

<template>
    <Head :title="t('auth_ui.confirm.title')" />

    <div class="space-y-6">
        <div class="space-y-2 text-center">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ t('auth_ui.confirm.title') }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{ t('auth_ui.confirm.description') }}
            </p>
        </div>

        <Form
            v-slot="{ errors, processing }"
            v-bind="store.form()"
            reset-on-success
            :reset-on-error="['password']"
            class="flex flex-col gap-5"
            @error="focusFirstError"
        >
            <div class="grid gap-2">
                <Label for="password"
                    >{{ t('auth_ui.confirm.password') }} <RequiredMark
                /></Label>
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

            <Button
                type="submit"
                size="lg"
                class="w-full"
                :disabled="processing"
                data-test="confirm-password-button"
            >
                <Spinner v-if="processing" />
                {{ t('auth_ui.confirm.submit') }}
            </Button>
        </Form>
    </div>
</template>
