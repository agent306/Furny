<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import InputError from '@/components/common/InputError.vue';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useControlSize } from '@/composables/useControlSize';
import type { ConfirmTone } from '@/composables/useConfirm';
import { useI18n } from '@/composables/useI18n';

// 15 §9.21: hold / cancel / decline / reject flows. Strings other than the two
// validation messages and the default button labels are already translated.
// `note` is trimmed; a blank note counts as empty.
const props = withDefaults(
    defineProps<{
        open: boolean;
        title: string;
        description?: string;
        /** Renders a radio group; choosing one is then required. */
        reasons?: { value: string; label: string }[];
        noteLabel: string;
        noteRequired: boolean;
        noteMaxLength?: number;
        confirmLabel?: string;
        tone?: ConfirmTone;
        processing?: boolean;
        /** Server validation errors by field (`reason`, `note`). */
        errors?: Record<string, string>;
    }>(),
    {
        description: undefined,
        reasons: undefined,
        noteMaxLength: 2000,
        confirmLabel: undefined,
        tone: 'default',
        errors: undefined,
    },
);

const emit = defineEmits<{
    submit: [payload: { reason?: string; note: string }];
    'update:open': [value: boolean];
}>();

// Without a description, say so: Reka warns when its default `aria-describedby`
// points at nothing.
const NO_DESCRIPTION = { 'aria-describedby': '' };

const { t } = useI18n();
const size = useControlSize();
const uid = useId();
const noteId = `${uid}-note`;
const noteErrorId = `${uid}-note-error`;
const reasonErrorId = `${uid}-reason-error`;

const reason = ref<string | undefined>(undefined);
const note = ref('');
const attempted = ref(false);

watch(
    () => props.open,
    () => {
        reason.value = undefined;
        note.value = '';
        attempted.value = false;
    },
);

const hasReasons = computed(() => (props.reasons?.length ?? 0) > 0);
const reasonError = computed(() =>
    attempted.value && hasReasons.value && !reason.value
        ? t('common.validation.reason_required')
        : props.errors?.reason,
);
const noteError = computed(() =>
    attempted.value && props.noteRequired && note.value.trim() === ''
        ? t('common.validation.note_required')
        : props.errors?.note,
);
const confirmVariant = computed(
    () =>
        ({
            default: 'default',
            destructive: 'destructive',
            warning: 'warning',
        })[props.tone] as 'default' | 'destructive' | 'warning',
);

function onSubmit(): void {
    attempted.value = true;

    const reasonMissing = hasReasons.value && !reason.value;
    const noteMissing = props.noteRequired && note.value.trim() === '';

    if (reasonMissing || noteMissing) {
        // 15 §10.1 / §14.8: focus moves to the first invalid field. The error
        // text renders on the next tick, with `aria-invalid` on the field.
        void nextTick(() => {
            const firstReason = props.reasons?.[0]?.value;
            const target =
                reasonMissing && firstReason !== undefined
                    ? document.getElementById(`${uid}-reason-${firstReason}`)
                    : document.getElementById(noteId);

            target?.focus();
        });

        return;
    }

    const trimmed = note.value.trim();

    emit(
        'submit',
        hasReasons.value
            ? { reason: reason.value, note: trimmed }
            : { note: trimmed },
    );
}

function onOpenChange(value: boolean): void {
    if (!value && props.processing) {
        return;
    }

    emit('update:open', value);
}
</script>

<template>
    <Dialog :open="open" @update:open="onOpenChange">
        <DialogContent
            :show-close-button="false"
            v-bind="description ? {} : NO_DESCRIPTION"
        >
            <form class="grid gap-4" novalidate @submit.prevent="onSubmit">
                <DialogHeader>
                    <DialogTitle>{{ title }}</DialogTitle>
                    <DialogDescription v-if="description">
                        {{ description }}
                    </DialogDescription>
                </DialogHeader>

                <div v-if="hasReasons" class="space-y-2">
                    <RadioGroup
                        v-model="reason"
                        :aria-invalid="reasonError ? 'true' : undefined"
                        :aria-describedby="
                            reasonError ? reasonErrorId : undefined
                        "
                        :disabled="processing"
                    >
                        <div
                            v-for="option in reasons"
                            :key="option.value"
                            class="flex items-center gap-2"
                        >
                            <RadioGroupItem
                                :id="`${uid}-reason-${option.value}`"
                                :value="option.value"
                            />
                            <Label :for="`${uid}-reason-${option.value}`">
                                {{ option.label }}
                            </Label>
                        </div>
                    </RadioGroup>
                    <InputError :id="reasonErrorId" :message="reasonError" />
                </div>

                <div class="space-y-2">
                    <Label :for="noteId">{{ noteLabel }}</Label>
                    <Textarea
                        :id="noteId"
                        v-model="note"
                        :maxlength="noteMaxLength"
                        :disabled="processing"
                        :aria-required="noteRequired ? 'true' : undefined"
                        :aria-invalid="noteError ? 'true' : undefined"
                        :aria-describedby="noteError ? noteErrorId : undefined"
                    />
                    <InputError :id="noteErrorId" :message="noteError" />
                </div>

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
                        :variant="confirmVariant"
                        :size="size"
                        :disabled="processing"
                    >
                        {{ confirmLabel ?? t('common.actions.confirm') }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
