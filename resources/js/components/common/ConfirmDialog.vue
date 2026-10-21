<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useControlSize } from '@/composables/useControlSize';
import type { ConfirmTone } from '@/composables/useConfirm';
import { useI18n } from '@/composables/useI18n';

// 15 §9.20. Confirm does not close the dialog: the parent does, via
// `update:open`, once its request has finished (long actions keep the dialog
// open, 15 §10.1). All strings are already translated except the two default
// button labels.
const props = withDefaults(
    defineProps<{
        open: boolean;
        title: string;
        description?: string;
        confirmLabel?: string;
        cancelLabel?: string;
        tone?: ConfirmTone;
        processing?: boolean;
        /** The user must type exactly this: case-sensitive, not trimmed. */
        requireText?: string;
        /** A checkbox with this label must be ticked. */
        checkboxLabel?: string;
    }>(),
    {
        description: undefined,
        confirmLabel: undefined,
        cancelLabel: undefined,
        tone: 'default',
        requireText: undefined,
        checkboxLabel: undefined,
    },
);

const emit = defineEmits<{
    confirm: [];
    'update:open': [value: boolean];
}>();

// Without a description, say so: Reka warns when its default `aria-describedby`
// points at nothing.
const NO_DESCRIPTION = { 'aria-describedby': '' };

const { t } = useI18n();
const size = useControlSize();

const typed = ref('');
const ticked = ref(false);
const textInputId = `confirm-text-${Math.random().toString(36).slice(2, 10)}`;
const checkboxId = `confirm-checkbox-${Math.random().toString(36).slice(2, 10)}`;

watch(
    () => props.open,
    () => {
        typed.value = '';
        ticked.value = false;
    },
);

const needsText = computed(
    () => props.requireText !== undefined && props.requireText !== '',
);
const canConfirm = computed(
    () =>
        !props.processing &&
        (!needsText.value || typed.value === props.requireText) &&
        (props.checkboxLabel === undefined || ticked.value),
);
const confirmVariant = computed(
    () =>
        ({
            default: 'default',
            destructive: 'destructive',
            warning: 'warning',
        })[props.tone] as 'default' | 'destructive' | 'warning',
);
// Destructive: the safe button first. Otherwise the first thing the user must
// do, which is the confirm button itself unless it is still locked.
const initialFocus = computed<'cancel' | 'text' | 'checkbox' | 'confirm'>(
    () => {
        if (props.tone === 'destructive') {
            return 'cancel';
        }

        if (needsText.value) {
            return 'text';
        }

        return props.checkboxLabel === undefined ? 'confirm' : 'checkbox';
    },
);

function onOpenChange(value: boolean): void {
    // Esc and the cancel button do nothing while a request is running.
    if (!value && props.processing) {
        return;
    }

    emit('update:open', value);
}

function onOpenAutoFocus(event: Event): void {
    event.preventDefault();

    const container =
        event.target instanceof HTMLElement ? event.target : document.body;

    // Reka's AlertDialogContent focuses its cancel button in a `nextTick` of
    // its own, queued right after this handler. Queue behind it, so the
    // button we chose wins.
    void nextTick(() =>
        nextTick(() =>
            container
                .querySelector<HTMLElement>('[data-initial-focus]')
                ?.focus(),
        ),
    );
}

function focusMark(target: typeof initialFocus.value): true | undefined {
    return initialFocus.value === target ? true : undefined;
}
</script>

<template>
    <AlertDialog :open="open" @update:open="onOpenChange">
        <AlertDialogContent
            v-bind="description ? {} : NO_DESCRIPTION"
            @open-auto-focus="onOpenAutoFocus"
        >
            <AlertDialogHeader>
                <AlertDialogTitle>{{ title }}</AlertDialogTitle>
                <AlertDialogDescription v-if="description">
                    {{ description }}
                </AlertDialogDescription>
            </AlertDialogHeader>

            <div v-if="needsText" class="space-y-2">
                <Label :for="textInputId">
                    {{
                        t('common.confirm.type_to_confirm', {
                            text: requireText,
                        })
                    }}
                </Label>
                <Input
                    :id="textInputId"
                    v-model="typed"
                    type="text"
                    :size="size"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    :disabled="processing"
                    :data-initial-focus="focusMark('text')"
                />
            </div>

            <div
                v-if="checkboxLabel !== undefined"
                class="flex items-start gap-2"
            >
                <Checkbox
                    :id="checkboxId"
                    v-model="ticked"
                    :disabled="processing"
                    :data-initial-focus="focusMark('checkbox')"
                />
                <Label :for="checkboxId" class="leading-snug">{{
                    checkboxLabel
                }}</Label>
            </div>

            <AlertDialogFooter>
                <AlertDialogCancel as-child>
                    <Button
                        type="button"
                        variant="outline"
                        :size="size"
                        :disabled="processing"
                        :data-initial-focus="focusMark('cancel')"
                    >
                        {{ cancelLabel ?? t('common.actions.cancel') }}
                    </Button>
                </AlertDialogCancel>
                <Button
                    type="button"
                    :variant="confirmVariant"
                    :size="size"
                    :disabled="!canConfirm"
                    :data-initial-focus="focusMark('confirm')"
                    @click="emit('confirm')"
                >
                    {{ confirmLabel ?? t('common.actions.confirm') }}
                </Button>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>
