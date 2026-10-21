<script setup lang="ts">
import { Head, Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import EmptyState from '@/components/common/EmptyState.vue';
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import type { IconName } from '@/lib/icons';
import { welcome } from '@/routes';
import { dashboard as adminDashboard } from '@/routes/admin';
import { dashboard as customerDashboard } from '@/routes/customer';

// 10 §4.10: one page for every handled status. The layout follows the
// audience (`resolveLayout`). It shows the status and a fixed message, never
// anything from the exception.
type Status = 403 | 404 | 419 | 429 | 500 | 503;

const props = defineProps<{
    status: Status;
}>();

const { t } = useI18n();
const page = usePage();
const size = useControlSize();

const ICON: Record<Status, IconName> = {
    403: 'lock',
    404: 'map-pin-off',
    419: 'refresh-cw',
    429: 'hourglass',
    500: 'alert-triangle',
    503: 'wrench',
};

const message = computed(() => t(`errors.pages.${props.status}`));
// A reload can fix an expired session, a transient failure and maintenance.
const reloadable = computed(() => [419, 500, 503].includes(props.status));
const audience = computed(() => page.props.auth?.user?.type ?? null);
const home = computed(() => {
    if (audience.value === 'staff') {
        return {
            href: adminDashboard(),
            labelKey: 'errors.actions.go_dashboard',
        };
    }

    return audience.value === 'customer'
        ? { href: customerDashboard(), labelKey: 'errors.actions.go_dashboard' }
        : { href: welcome(), labelKey: 'errors.actions.go_home' };
});

function reload(): void {
    window.location.reload();
}
</script>

<template>
    <Head :title="t('errors.status_code', { status })" />
    <h1 tabindex="-1" class="sr-only">
        {{ t('errors.status_code', { status }) }}
    </h1>
    <EmptyState :icon="ICON[status]" size="lg" :title="message">
        <template #actions>
            <Button as-child :size="size">
                <Link :href="home.href">{{ t(home.labelKey) }}</Link>
            </Button>
            <Button
                v-if="reloadable"
                variant="outline"
                :size="size"
                @click="reload"
            >
                {{ t('errors.actions.reload') }}
            </Button>
        </template>
    </EmptyState>
</template>
