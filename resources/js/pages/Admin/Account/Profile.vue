<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import AccountPage from '@/components/account/AccountPage.vue';
import ProfileForm from '@/components/account/ProfileForm.vue';
import { useI18n } from '@/composables/useI18n';
import type { AuthUserData, OtpChannel } from '@/types';

// 11 §18 (AccountProfileProps): the shell and the profile sections; the persistent layout is AdminLayout.
defineProps<{
    user: AuthUserData;
    marketingOptIn: boolean;
    otpChannels: OtpChannel[];
}>();

const { t } = useI18n();
</script>

<template>
    <Head :title="t('account.profile.title')" />

    <AccountPage
        audience="admin"
        :title="t('account.profile.title')"
        :description="t('account.profile.description')"
    >
        <ProfileForm
            audience="admin"
            :user="user"
            :marketing-opt-in="marketingOptIn"
            :otp-channels="otpChannels"
        />
    </AccountPage>
</template>
