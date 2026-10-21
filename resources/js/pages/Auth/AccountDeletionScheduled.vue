<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { welcome } from '@/routes';

// 13 §9.1, 14 §2 (AccountDeletionScheduledProps): where a customer lands after asking to delete the account. They are
// signed out by now; the date comes from a one-time flash, so a page opened directly has none.
const props = defineProps<{
    anonymiseOn: string | null;
    supportEmail: string;
}>();

const { t } = useI18n();
const { formatDate } = useFormat();

const title = computed(() => t('account.deleted.title'));
const body = computed(() =>
    props.anonymiseOn === null
        ? t('account.deleted.body_undated')
        : t('account.deleted.body_dated', {
              date: formatDate(props.anonymiseOn, 'long'),
          }),
);
</script>

<template>
    <Head :title="title" />

    <div class="space-y-6 text-center" data-test="account-deletion-scheduled">
        <div class="space-y-2">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ title }}
            </h1>
            <p class="text-sm text-muted-foreground" data-test="deleted-body">
                {{ body }}
            </p>
            <p
                class="text-sm text-muted-foreground"
                data-test="deleted-restore"
            >
                {{ t('account.deleted.restore', { email: supportEmail }) }}
            </p>
        </div>

        <Button as-child size="lg" variant="outline" class="w-full">
            <Link :href="welcome()" data-test="home-link">{{
                t('account.deleted.home')
            }}</Link>
        </Button>
    </div>
</template>
