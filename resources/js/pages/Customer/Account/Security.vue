<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import AccountPage from '@/components/account/AccountPage.vue';
import GoogleLinkCard from '@/components/account/GoogleLinkCard.vue';
import PasswordForm from '@/components/account/PasswordForm.vue';
import SessionsList from '@/components/account/SessionsList.vue';
import { useI18n } from '@/composables/useI18n';
import type { SessionData } from '@/types';

// 10 §13 (AccountSecurityProps): password, Google and the devices; the persistent layout is CustomerLayout.
defineProps<{
    hasPassword: boolean;
    googleLinked: boolean;
    googleEnabled: boolean;
    sessions: SessionData[];
}>();

const { t } = useI18n();
</script>

<template>
    <Head :title="t('account.security.title')" />

    <AccountPage
        audience="customer"
        :title="t('account.security.title')"
        :description="t('account.security.description')"
    >
        <PasswordForm :has-password="hasPassword" />
        <GoogleLinkCard :linked="googleLinked" :enabled="googleEnabled" />
        <SessionsList :sessions="sessions" />
    </AccountPage>
</template>
