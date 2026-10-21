<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import { ORDER_STATE_ICON, ORDER_STATE_TONE } from '@/lib/statusTones';
import type { OrderStateKey } from '@/types/domain';

// 15 §9.3. The state is never colour alone (15 §14.10): every badge has its
// text label and, with `showDot` (default), the state's icon as the leading
// marker instead of a bare, colour-only dot.
const props = withDefaults(
    defineProps<{
        state: OrderStateKey;
        /** Defaults from `auth.user.type`; a guest gets the customer wording. */
        audience?: 'customer' | 'staff';
        size?: 'sm' | 'md';
        showDot?: boolean;
    }>(),
    { audience: undefined, size: 'md', showDot: true },
);

const { t } = useI18n();
const page = usePage();

const audience = computed(
    () =>
        props.audience ??
        ((page.props as { auth?: { user?: { type?: string } | null } }).auth
            ?.user?.type === 'staff'
            ? 'staff'
            : 'customer'),
);
const isCustomer = computed(() => audience.value === 'customer');
const tone = computed(() => ORDER_STATE_TONE[props.state]);
const iconName = computed(() => ORDER_STATE_ICON[props.state]);
const label = computed(() =>
    isCustomer.value
        ? t(`orders.states_customer_short.${props.state}`)
        : t(`orders.states.${props.state}`),
);
// Customers hear the full sentence ("Action needed: review your quote") while
// the badge shows the short label; `role="img"` makes the name valid on a span.
const fullSentence = computed(() =>
    isCustomer.value ? t(`orders.states_customer.${props.state}`) : undefined,
);
</script>

<template>
    <Badge
        :variant="tone"
        :data-tone="tone"
        :role="fullSentence ? 'img' : undefined"
        :aria-label="fullSentence"
        :class="
            size === 'sm'
                ? 'px-1.5 py-0 text-[11px] leading-4'
                : 'px-2.5 py-0.5 text-xs'
        "
    >
        <component
            :is="ICONS[iconName]"
            v-if="showDot"
            :data-icon="iconName"
            aria-hidden="true"
        />
        {{ label }}
    </Badge>
</template>
