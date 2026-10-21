<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { ref, watch } from 'vue';
import StaffRolePicker from '@/components/admin/staff/StaffRolePicker.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useControlSize } from '@/composables/useControlSize';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { store } from '@/routes/admin/staff/invitations';
import type { StaffRole, StaffRoleOption } from '@/types';

// 11 §7: name, email and one role. Sent to `admin.staff.invitations.store`; `staff.email_in_use` and
// `staff.invitation_pending` come back as the error of the email field.
const props = defineProps<{
    open: boolean;
    roles: readonly StaffRoleOption[];
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const { t } = useI18n();
const size = useControlSize();
const { focusFirstError } = useFocusFirstError(
    () => document.querySelector('[role="dialog"]') ?? document,
);

const name = ref('');
const email = ref('');
const role = ref<StaffRole | ''>('');
const processing = ref(false);

// The refusals of this dialog's own send, not the page's errors: those outlive the dialog and are also where the
// refusal of an action elsewhere on the page (a resend) is left.
const errors = ref<Record<string, string>>({});

// Every time the dialog opens it starts over, with no refusal of the time before.
watch(
    () => props.open,
    (open) => {
        if (open) {
            name.value = '';
            email.value = '';
            role.value = '';
            errors.value = {};
        }
    },
);

function submit(): void {
    if (processing.value || role.value === '') {
        return;
    }

    router.post(
        store.url(),
        { name: name.value, email: email.value, role: role.value },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                processing.value = true;
                errors.value = {};
            },
            onFinish: () => (processing.value = false),
            onSuccess: () => emit('update:open', false),
            onError: (refused) => {
                errors.value = refused;
                void focusFirstError();
            },
        },
    );
}

function onOpenChange(value: boolean): void {
    if (!value && processing.value) {
        return;
    }

    emit('update:open', value);
}
</script>

<template>
    <Dialog :open="open" @update:open="onOpenChange">
        <DialogContent :show-close-button="false">
            <DialogHeader>
                <DialogTitle>{{ t('staff.invite_dialog.title') }}</DialogTitle>
                <DialogDescription>
                    {{ t('staff.invite_dialog.description') }}
                </DialogDescription>
            </DialogHeader>

            <form
                class="grid gap-4"
                novalidate
                data-test="invite-form"
                @submit.prevent="submit"
            >
                <div class="grid gap-2">
                    <Label for="invite-name"
                        >{{ t('staff.invite_dialog.name') }} <RequiredMark
                    /></Label>
                    <Input
                        id="invite-name"
                        v-model="name"
                        name="name"
                        type="text"
                        :size="size"
                        required
                        aria-required="true"
                        minlength="2"
                        maxlength="120"
                        autocomplete="off"
                        :disabled="processing"
                        :aria-invalid="errors.name ? 'true' : undefined"
                        :aria-describedby="
                            errors.name ? 'invite-name-error' : undefined
                        "
                    />
                    <InputError id="invite-name-error" :message="errors.name" />
                </div>

                <div class="grid gap-2">
                    <Label for="invite-email"
                        >{{ t('staff.invite_dialog.email') }} <RequiredMark
                    /></Label>
                    <Input
                        id="invite-email"
                        v-model="email"
                        name="email"
                        type="email"
                        :size="size"
                        required
                        aria-required="true"
                        maxlength="254"
                        autocomplete="off"
                        :disabled="processing"
                        :aria-invalid="errors.email ? 'true' : undefined"
                        :aria-describedby="
                            errors.email ? 'invite-email-error' : undefined
                        "
                    />
                    <InputError
                        id="invite-email-error"
                        :message="errors.email"
                    />
                </div>

                <fieldset class="grid gap-2">
                    <legend class="text-sm leading-none font-medium">
                        {{ t('staff.invite_dialog.role') }} <RequiredMark />
                    </legend>
                    <StaffRolePicker
                        id="invite-role"
                        v-model="role"
                        :roles="roles"
                        :disabled="processing"
                        :invalid="Boolean(errors.role)"
                        :describedby="
                            errors.role ? 'invite-role-error' : undefined
                        "
                    />
                    <InputError id="invite-role-error" :message="errors.role" />
                </fieldset>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        :size="size"
                        :disabled="processing"
                        @click="onOpenChange(false)"
                    >
                        {{ t('common.actions.cancel') }}
                    </Button>
                    <Button
                        type="submit"
                        :size="size"
                        :disabled="processing || role === ''"
                        data-test="invite-submit"
                    >
                        <Spinner v-if="processing" />
                        {{ t('staff.invite_dialog.submit') }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
