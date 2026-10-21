<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import EmptyState from '@/components/common/EmptyState.vue';
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';

// 15 §6: shown on a phone by pages that need a tablet or computer.
defineProps<{
    backHref?: string;
}>();

const { t } = useI18n();
const size = useControlSize();
</script>

<template>
    <EmptyState
        icon="monitor-smartphone"
        :title="t('common.screen_too_small.title')"
        :description="t('common.screen_too_small.body')"
    >
        <template v-if="backHref" #actions>
            <Button as-child variant="outline" :size="size">
                <Link :href="backHref">{{ t('common.actions.back') }}</Link>
            </Button>
        </template>
    </EmptyState>
</template>
