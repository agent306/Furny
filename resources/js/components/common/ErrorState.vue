<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';

// 15 §9.31: full-section load failure (deferred props, API widgets).
defineProps<{
    /** Defaults to `errors.load_failed`. */
    title?: string;
    description?: string;
    retry?: () => void;
    /** HTTP status, shown as a small caption. */
    status?: number;
}>();

const { t } = useI18n();
const size = useControlSize();
</script>

<template>
    <div
        role="alert"
        class="flex flex-col items-center gap-3 px-4 py-10 text-center"
    >
        <div
            class="flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger-subtle-foreground"
        >
            <component
                :is="ICONS['alert-triangle']"
                class="size-6"
                aria-hidden="true"
            />
        </div>
        <h2 class="text-lg font-semibold">
            {{ title ?? t('errors.load_failed') }}
        </h2>
        <p v-if="description" class="max-w-sm text-muted-foreground">
            {{ description }}
        </p>
        <p v-if="status" class="text-xs text-muted-foreground">
            {{ t('errors.status_code', { status }) }}
        </p>
        <Button
            v-if="retry"
            type="button"
            variant="outline"
            :size="size"
            @click="retry()"
        >
            {{ t('common.actions.retry') }}
        </Button>
    </div>
</template>
