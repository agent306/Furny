<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { ref } from 'vue';
import AccountPage from '@/components/account/AccountPage.vue';
import FormSection from '@/components/common/FormSection.vue';
import InputError from '@/components/common/InputError.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useControlSize } from '@/composables/useControlSize';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { destroy, exportMethod, profile } from '@/routes/customer/account';
import type { ActiveOrderRefData } from '@/types';

// 10 §13.7 (AccountDeleteProps): the data download and the deletion; the persistent layout is CustomerLayout. The
// deletion asks for the translated word for DELETE; the server decides whether it is the right one and whether an Active
// order blocks it (13 §9.1). The orders are listed by number: their pages arrive with the order tasks.
defineProps<{
    activeOrders: ActiveOrderRefData[];
    canExport: boolean;
}>();

const { t } = useI18n();
const size = useControlSize();
const { focusFirstError } = useFocusFirstError();

const form = useForm({ confirmation: '' });
// A refusal with no field of its own (`_error`, 14 §1.9): an Active order appeared since the page was opened.
const refusal = ref<string>();

function submit(): void {
    refusal.value = undefined;

    form.delete(destroy.url(), {
        preserveScroll: true,
        onError: (errors) => {
            refusal.value = errors._error;
            void focusFirstError();
        },
    });
}
</script>

<template>
    <Head :title="t('account.delete.title')" />

    <AccountPage
        audience="customer"
        :title="t('account.delete.title')"
        :description="t('account.delete.description')"
    >
        <FormSection
            :title="t('account.delete.export.title')"
            :description="t('account.delete.export.description')"
        >
            <div v-if="canExport">
                <!-- A plain link: the response is a file, not an Inertia page. -->
                <Button as-child :size="size" variant="outline">
                    <a
                        :href="exportMethod.url()"
                        download
                        data-test="export-link"
                        >{{ t('account.delete.export.action') }}</a
                    >
                </Button>
            </div>
            <Alert v-else role="status" data-test="export-unverified">
                <AlertDescription class="space-y-2">
                    <p>{{ t('common.verify_required') }}</p>
                    <Button as-child size="sm" variant="outline">
                        <Link :href="profile.url()" data-test="export-verify">{{
                            t('account.delete.export.verify')
                        }}</Link>
                    </Button>
                </AlertDescription>
            </Alert>
        </FormSection>

        <FormSection
            :title="t('account.delete.danger.title')"
            :description="t('account.delete.danger.description')"
        >
            <ul class="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{{ t('account.delete.danger.kept') }}</li>
                <li>{{ t('account.delete.danger.removed') }}</li>
                <li>{{ t('account.delete.danger.recovery') }}</li>
            </ul>

            <Alert v-if="activeOrders.length > 0" data-test="active-orders">
                <AlertDescription class="space-y-2">
                    <p>{{ t('account.delete.danger.blocked') }}</p>
                    <ul class="list-disc pl-5 font-mono text-sm">
                        <li
                            v-for="order in activeOrders"
                            :key="order.id"
                            data-test="active-order"
                        >
                            {{ order.number }}
                        </li>
                    </ul>
                </AlertDescription>
            </Alert>

            <form
                v-else
                class="grid gap-4"
                novalidate
                data-test="delete-form"
                @submit.prevent="submit"
            >
                <div class="grid gap-2">
                    <Label for="confirmation">{{
                        t('account.delete.danger.confirm_label', {
                            word: t('account.delete_word'),
                        })
                    }}</Label>
                    <Input
                        id="confirmation"
                        v-model="form.confirmation"
                        name="confirmation"
                        :size="size"
                        autocomplete="off"
                        autocapitalize="characters"
                        :aria-invalid="
                            form.errors.confirmation ? 'true' : undefined
                        "
                        :aria-describedby="
                            form.errors.confirmation
                                ? 'confirmation-error'
                                : undefined
                        "
                    />
                    <InputError
                        id="confirmation-error"
                        :message="form.errors.confirmation"
                    />
                    <InputError id="delete-error" :message="refusal" />
                </div>

                <div>
                    <Button
                        type="submit"
                        variant="destructive"
                        :size="size"
                        :disabled="form.processing"
                        data-test="delete-submit"
                    >
                        <Spinner v-if="form.processing" />
                        {{ t('account.delete.danger.action') }}
                    </Button>
                </div>
            </form>
        </FormSection>
    </AccountPage>
</template>
