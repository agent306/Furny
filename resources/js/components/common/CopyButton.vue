<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';

// 15 §9.31: copies `value`, toasts "Copied", and shows a check for 2 s.
const props = defineProps<{
    value: string;
    /** Accessible name; defaults to `common.actions.copy`. */
    label?: string;
}>();

const { t } = useI18n();
const controlSize = useControlSize();
const size = computed(() => (controlSize.value === 'lg' ? 'icon-lg' : 'icon'));
const name = computed(() => props.label ?? t('common.actions.copy'));
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
    try {
        await navigator.clipboard.writeText(props.value);
    } catch {
        // Denied, insecure context or no clipboard API at all.
        toast.error(t('errors.copy_failed'));

        return;
    }

    toast.success(t('common.copied'));
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
        copied.value = false;
    }, 2000);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
    <Button
        type="button"
        variant="ghost"
        :size="size"
        :aria-label="name"
        :title="name"
        @click="copy"
    >
        <component
            :is="ICONS[copied ? 'check' : 'copy']"
            :data-icon="copied ? 'check' : 'copy'"
            aria-hidden="true"
        />
    </Button>
</template>
