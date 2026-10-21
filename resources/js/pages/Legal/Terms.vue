<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import LegalDocument from '@/components/app/LegalDocument.vue';
import { useI18n } from '@/composables/useI18n';

// 10 §4.9. The layout follows the audience (`resolveLayout`).
defineProps<{
    businessName: string;
    /** ISO date. */
    updatedOn: string;
}>();

const { t } = useI18n();
</script>

<template>
    <Head :title="t('legal.terms.title')" />
    <LegalDocument
        :title="t('legal.terms.title')"
        :body="t('legal.terms.body', { business: businessName })"
        :updated-on="updatedOn"
    />
</template>
