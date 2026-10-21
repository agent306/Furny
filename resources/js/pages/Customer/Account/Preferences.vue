<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import AccountPage from '@/components/account/AccountPage.vue';
import PreferencesForm from '@/components/account/PreferencesForm.vue';
import { useI18n } from '@/composables/useI18n';
import type { LengthUnit, UnitSystem } from '@/types';

// 10 §13 (AccountPreferencesProps): units, time zone and appearance; the persistent layout is CustomerLayout.
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
        audience="customer"
        :title="t('account.preferences.title')"
        :description="t('account.preferences.description')"
    >
        <PreferencesForm
            audience="customer"
            :unit-system="unitSystem"
            :length-unit="lengthUnit"
            :timezone="timezone"
            :timezones="timezones"
        />
    </AccountPage>
</template>
