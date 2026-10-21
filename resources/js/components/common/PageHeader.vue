<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { computed, useSlots } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { Tone } from '@/types/ui';

// 15 §9.2. The one `h1` of a page; it is focusable (`tabindex="-1"`) so route
// changes can move focus to it (15 §14.4). Strings are already translated.
defineProps<{
    title: string;
    description?: string;
    /** Renders a back icon button. */
    backHref?: string;
    badge?: { label: string; tone: Tone };
}>();

const { t } = useI18n();
const slots = useSlots();
const controlSize = useControlSize();
const buttonSize = computed(() =>
    controlSize.value === 'lg' ? 'icon-lg' : 'icon',
);
</script>

<template>
    <header
        class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
    >
        <div class="flex min-w-0 items-start gap-3">
            <Button
                v-if="backHref"
                as-child
                variant="ghost"
                :size="buttonSize"
                class="-ml-2 shrink-0"
            >
                <Link
                    :href="backHref"
                    :aria-label="t('common.actions.back')"
                    :title="t('common.actions.back')"
                >
                    <component :is="ICONS['arrow-left']" aria-hidden="true" />
                </Link>
            </Button>
            <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                    <h1
                        tabindex="-1"
                        class="text-2xl font-semibold tracking-tight break-words outline-none"
                    >
                        {{ title }}
                    </h1>
                    <Badge
                        v-if="badge"
                        :variant="badge.tone"
                        :data-tone="badge.tone"
                    >
                        {{ badge.label }}
                    </Badge>
                </div>
                <p v-if="description" class="text-muted-foreground">
                    {{ description }}
                </p>
                <div
                    v-if="slots.meta"
                    data-slot="page-header-meta"
                    class="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground"
                >
                    <slot name="meta" />
                </div>
            </div>
        </div>
        <div
            v-if="slots.actions"
            data-slot="page-header-actions"
            class="flex flex-wrap items-center gap-2 max-md:w-full max-md:*:first:w-full md:shrink-0 md:justify-end"
        >
            <slot name="actions" />
        </div>
    </header>
</template>
