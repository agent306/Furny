<script setup lang="ts">
import { Badge } from '@/components/ui/badge';
import { ICONS } from '@/lib/icons';
import type { IconName } from '@/lib/icons';
import type { Tone } from '@/types/ui';

// Generic tone + label badge for the non-order status enums (`lib/statusTones`).
// `label` is already translated. The label carries the meaning; the tone and
// the optional icon only reinforce it.
defineProps<{
    tone: Tone;
    label: string;
    icon?: IconName;
}>();
</script>

<template>
    <Badge :variant="tone" :data-tone="tone">
        <component
            :is="ICONS[icon]"
            v-if="icon"
            :data-icon="icon"
            aria-hidden="true"
        />
        {{ label }}
    </Badge>
</template>
