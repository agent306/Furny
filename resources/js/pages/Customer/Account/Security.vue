<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import AccountPage from '@/components/account/AccountPage.vue';
import GoogleLinkCard from '@/components/account/GoogleLinkCard.vue';
import PasswordForm from '@/components/account/PasswordForm.vue';
import PhoneSignInCard from '@/components/account/PhoneSignInCard.vue';
import SessionsList from '@/components/account/SessionsList.vue';
import { useI18n } from '@/composables/useI18n';
import type { SessionData } from '@/types';

// 10 §13 (AccountSecurityProps): password, Google, phone sign-in and the devices; the persistent layout is CustomerLayout.
defineProps<{
    hasPassword: boolean;
    googleLinked: boolean;
    googleEnabled: boolean;
    sessions: SessionData[];
}>();

const { t } = useI18n();
// Phone sign-in reads the number of the signed-in user, which every page already carries (AuthUserData).
const user = computed(() => usePage().props.auth?.user ?? null);
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
        <PhoneSignInCard
            :phone="user?.phoneE164 ?? null"
            :verified="user?.phoneVerified ?? false"
        />
        <SessionsList :sessions="sessions" />
    </AccountPage>
</template>
