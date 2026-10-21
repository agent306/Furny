<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import EmptyState from '@/components/common/EmptyState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { useI18n } from '@/composables/useI18n';

// 11 §4. A placeholder: the work queue and KPIs arrive with P7. The persistent
// layout is AdminLayout.
const { t } = useI18n();
</script>

<template>
    <Head :title="t('dashboard.admin.title')" />
    <div class="space-y-6">
        <PageHeader :title="t('dashboard.admin.title')" />
        <EmptyState
            icon="layout-dashboard"
            size="lg"
            :title="t('dashboard.admin.placeholder.title')"
            :description="t('dashboard.admin.placeholder.body')"
        />
    </div>
</template>
