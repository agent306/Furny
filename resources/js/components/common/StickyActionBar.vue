<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';

// 15 §9.31: bottom-sticky save bar for long forms. Visible only while the form
// is dirty. Save is a submit button, so place the bar inside the `<form>` or
// point `form` at its id; Discard only emits.
withDefaults(
    defineProps<{
        dirty: boolean;
        processing?: boolean;
        /** `id` of the `<form>` Save submits, when the bar sits outside it. */
        form?: string;
    }>(),
    { form: undefined },
);

defineEmits<{
    discard: [];
}>();

const { t } = useI18n();
const size = useControlSize();
</script>

<template>
    <div
        v-if="dirty"
        data-slot="sticky-action-bar"
        role="region"
        :aria-label="t('common.unsaved_changes')"
        class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
        <p class="text-sm font-medium">{{ t('common.unsaved_changes') }}</p>
        <slot />
        <div class="flex items-center gap-2">
            <Button
                type="button"
                variant="outline"
                :size="size"
                :disabled="processing"
                @click="$emit('discard')"
            >
                {{ t('common.actions.discard') }}
            </Button>
            <Button
                type="submit"
                :form="form"
                :size="size"
                :disabled="processing"
            >
                {{ t('common.actions.save_changes') }}
            </Button>
        </div>
    </div>
</template>
