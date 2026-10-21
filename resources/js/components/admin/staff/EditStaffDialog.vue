<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
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
import { update } from '@/routes/admin/staff';
import type { StaffRole, StaffRoleOption, StaffRowData } from '@/types';

// 11 §7: the name and the one role of a member, sent to `admin.staff.update`. `staff.last_owner` and
// `staff.errors.self` come back as the error of the role field.
const props = defineProps<{
    open: boolean;
    member: StaffRowData | null;
    roles: readonly StaffRoleOption[];
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const { t } = useI18n();
const size = useControlSize();
const page = usePage();
const { focusFirstError } = useFocusFirstError(
    () => document.querySelector('[role="dialog"]') ?? document,
);

const name = ref('');
const role = ref<StaffRole | ''>('');
const processing = ref(false);

const errors = computed(() => page.props.errors ?? {});

watch(
    () => [props.open, props.member?.id] as const,
    ([open]) => {
        if (open && props.member !== null) {
            name.value = props.member.name;
            role.value = props.member.role as StaffRole;
        }
    },
    { immediate: true },
);

function submit(): void {
    if (processing.value || props.member === null || role.value === '') {
        return;
    }

    router.put(
        update.url(props.member.id),
        { name: name.value, role: role.value },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (processing.value = true),
            onFinish: () => (processing.value = false),
            onSuccess: () => emit('update:open', false),
            onError: () => void focusFirstError(),
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
    <Dialog :open="open && member !== null" @update:open="onOpenChange">
        <DialogContent v-if="member" :show-close-button="false">
            <DialogHeader>
                <DialogTitle>{{
                    t('staff.edit_dialog.title', { name: member.name })
                }}</DialogTitle>
                <DialogDescription>
                    {{ t('staff.edit_dialog.description') }}
                </DialogDescription>
            </DialogHeader>

            <form
                class="grid gap-4"
                novalidate
                data-test="edit-form"
                @submit.prevent="submit"
            >
                <div class="grid gap-2">
                    <Label for="edit-name"
                        >{{ t('staff.edit_dialog.name') }} <RequiredMark
                    /></Label>
                    <Input
                        id="edit-name"
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
                            errors.name ? 'edit-name-error' : undefined
                        "
                    />
                    <InputError id="edit-name-error" :message="errors.name" />
                </div>

                <fieldset class="grid gap-2">
                    <legend class="text-sm leading-none font-medium">
                        {{ t('staff.edit_dialog.role') }} <RequiredMark />
                    </legend>
                    <StaffRolePicker
                        id="edit-role"
                        v-model="role"
                        :roles="roles"
                        :disabled="processing"
                        :invalid="Boolean(errors.role)"
                        :describedby="
                            errors.role ? 'edit-role-error' : undefined
                        "
                    />
                    <InputError id="edit-role-error" :message="errors.role" />
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
                        data-test="edit-submit"
                    >
                        <Spinner v-if="processing" />
                        {{ t('staff.edit_dialog.submit') }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
