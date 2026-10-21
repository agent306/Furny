<script setup lang="ts">
import { useForm } from '@inertiajs/vue3';
import FormSection from '@/components/common/FormSection.vue';
import InputError from '@/components/common/InputError.vue';
import PasswordField from '@/components/auth/PasswordField.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useControlSize } from '@/composables/useControlSize';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { update } from '@/routes/user-password';

// 10 §13.3: Fortify's `user-password.update`. A user without a password (phone or Google sign-up) sets the first one:
// the title says so and there is no current-password field (13 §5.5). The toast comes from the response.
const props = defineProps<{ hasPassword: boolean }>();

const { t } = useI18n();
const size = useControlSize();
const { focusFirstError } = useFocusFirstError();

const form = useForm({
    current_password: '',
    password: '',
    password_confirmation: '',
});

function submit(): void {
    form.transform((data) =>
        props.hasPassword
            ? data
            : {
                  password: data.password,
                  password_confirmation: data.password_confirmation,
              },
    ).put(update.url(), {
        preserveScroll: true,
        onSuccess: () => form.reset(),
        onError: () => {
            form.reset('password', 'password_confirmation');
            void focusFirstError();
        },
    });
}
</script>

<template>
    <FormSection
        :title="
            t(
                hasPassword
                    ? 'account.security.password.title'
                    : 'account.security.password.set_title',
            )
        "
        :description="
            t(
                hasPassword
                    ? 'account.security.password.description'
                    : 'account.security.password.set_description',
            )
        "
    >
        <form
            class="grid gap-4"
            novalidate
            data-test="password-form"
            @submit.prevent="submit"
        >
            <div v-if="hasPassword" class="grid gap-2">
                <Label for="current_password"
                    >{{ t('account.security.password.current') }} <RequiredMark
                /></Label>
                <PasswordField
                    id="current_password"
                    v-model="form.current_password"
                    name="current_password"
                    :size="size"
                    required
                    aria-required="true"
                    autocomplete="current-password"
                    :aria-invalid="
                        form.errors.current_password ? 'true' : undefined
                    "
                    :aria-describedby="
                        form.errors.current_password
                            ? 'current-password-error'
                            : undefined
                    "
                />
                <InputError
                    id="current-password-error"
                    :message="form.errors.current_password"
                />
            </div>

            <div class="grid gap-2">
                <Label for="password"
                    >{{ t('account.security.password.new') }} <RequiredMark
                /></Label>
                <PasswordField
                    id="password"
                    v-model="form.password"
                    name="password"
                    :size="size"
                    required
                    aria-required="true"
                    autocomplete="new-password"
                    :aria-invalid="form.errors.password ? 'true' : undefined"
                    :aria-describedby="
                        form.errors.password ? 'password-error' : undefined
                    "
                />
                <InputError
                    id="password-error"
                    :message="form.errors.password"
                />
            </div>

            <div class="grid gap-2">
                <Label for="password_confirmation"
                    >{{ t('account.security.password.confirmation') }}
                    <RequiredMark
                /></Label>
                <PasswordField
                    id="password_confirmation"
                    v-model="form.password_confirmation"
                    name="password_confirmation"
                    :size="size"
                    required
                    aria-required="true"
                    autocomplete="new-password"
                />
            </div>

            <div>
                <Button
                    type="submit"
                    :size="size"
                    :disabled="form.processing"
                    data-test="password-submit"
                >
                    <Spinner v-if="form.processing" />
                    {{
                        t(
                            hasPassword
                                ? 'account.security.password.save'
                                : 'account.security.password.set',
                        )
                    }}
                </Button>
            </div>
        </form>
    </FormSection>
</template>
