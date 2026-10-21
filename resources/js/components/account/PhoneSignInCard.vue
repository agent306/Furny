<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import FormSection from '@/components/common/FormSection.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { profile } from '@/routes/customer/account';

// 10 §13.3: whether signing in with a code sent to the phone works (it needs a verified number), and the way to the
// phone section of the profile (`#phone`), where the number is added, verified or changed. Customers only: staff sign
// in with their email (11 §18).
defineProps<{
    phone: string | null;
    verified: boolean;
}>();

const { t } = useI18n();
const size = useControlSize();
</script>

<template>
    <FormSection
        :title="t('account.security.phone.title')"
        :description="t('account.security.phone.description')"
        data-test="phone-signin-card"
    >
        <div>
            <Badge
                :variant="verified && phone ? 'success' : 'neutral'"
                data-test="phone-signin-status"
                >{{
                    verified && phone
                        ? t('account.security.phone.on', { phone })
                        : t('account.security.phone.off')
                }}</Badge
            >
        </div>
        <Button as-child variant="outline" :size="size" class="w-fit">
            <Link
                :href="`${profile.url()}#phone`"
                data-test="phone-signin-link"
                >{{ t('account.security.phone.manage') }}</Link
            >
        </Button>
    </FormSection>
</template>
