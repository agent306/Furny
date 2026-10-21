<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import AccountPage from '@/components/account/AccountPage.vue';
import PreferencesForm from '@/components/account/PreferencesForm.vue';
import { useI18n } from '@/composables/useI18n';
import type { LengthUnit, UnitSystem } from '@/types';

// 11 §18 (AccountPreferencesProps): units, time zone and appearance; the persistent layout is AdminLayout.
defineProps<{
    unitSystem: UnitSystem;
    lengthUnit: LengthUnit;
    timezone: string;
    timezones: string[];
}>();

const { t } = useI18n();
</script>

<template>
    <Head :title="t('account.preferences.title')" />

    <AccountPage
        audience="admin"
        :title="t('account.preferences.title')"
        :description="t('account.preferences.description')"
    >
        <PreferencesForm
            audience="admin"
            :unit-system="unitSystem"
            :length-unit="lengthUnit"
            :timezone="timezone"
            :timezones="timezones"
        />
    </AccountPage>
</template>
