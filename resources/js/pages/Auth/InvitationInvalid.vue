<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/composables/useI18n';
import { login, logout } from '@/routes';

// 11 §7.1, 14 §3.4: why the link of an invitation cannot be used. Somebody who is signed in is asked to sign out first
// (the button posts to `logout`); everybody else is pointed at the sign-in page.
type Reason = 'invalid' | 'expired' | 'accepted' | 'revoked' | 'signed_in';

const props = defineProps<{ reason: Reason }>();

const { t } = useI18n();

const COPY: Record<Reason, { title: () => string; body: () => string }> = {
    invalid: {
        title: () => t('staff.invalid.title.invalid'),
        body: () => t('staff.invalid.body.invalid'),
    },
    expired: {
        title: () => t('staff.invalid.title.expired'),
        body: () => t('staff.invalid.body.expired'),
    },
    accepted: {
        title: () => t('staff.invalid.title.accepted'),
        body: () => t('staff.invalid.body.accepted'),
    },
    revoked: {
        title: () => t('staff.invalid.title.revoked'),
        body: () => t('staff.invalid.body.revoked'),
    },
    signed_in: {
        title: () => t('staff.invalid.title.signed_in'),
        body: () => t('staff.invalid.body.signed_in'),
    },
};

const title = computed(() => COPY[props.reason].title());
const body = computed(() => COPY[props.reason].body());

// A fresh session must not see cached pages of the previous one.
function onLogout(): void {
    router.flushAll();
}
</script>

<template>
    <Head :title="title" />

    <div class="space-y-6 text-center" data-test="invitation-invalid">
        <div class="space-y-2">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ title }}
            </h1>
            <p class="text-sm text-muted-foreground" data-test="reason-body">
                {{ body }}
            </p>
        </div>

        <Button v-if="reason === 'signed_in'" as-child size="lg" class="w-full">
            <Link
                :href="logout()"
                as="button"
                data-test="sign-out-button"
                @click="onLogout"
            >
                {{ t('staff.invalid.sign_out') }}
            </Link>
        </Button>
        <Button v-else as-child size="lg" variant="outline" class="w-full">
            <Link :href="login()" data-test="login-link">
                {{ t('staff.invalid.log_in') }}
            </Link>
        </Button>
    </div>
</template>
