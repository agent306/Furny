<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import EmptyState from '@/components/common/EmptyState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { useI18n } from '@/composables/useI18n';

// 10 §6. A placeholder: the action items, projects, orders and credits arrive
// with the features that own them. The persistent layout is CustomerLayout.
const { t } = useI18n();
const page = usePage();
const name = computed(() => page.props.auth?.user?.name ?? '');
</script>

<template>
    <Head :title="t('common.nav.dashboard')" />
    <div class="space-y-6">
        <PageHeader :title="t('dashboard.title', { name })" />
        <EmptyState
            icon="house"
            size="lg"
            :title="t('dashboard.customer.empty.title')"
            :description="t('dashboard.customer.empty.body')"
        />
    </div>
</template>
