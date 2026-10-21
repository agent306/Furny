<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import GoogleButton from '@/components/auth/GoogleButton.vue';
import FormSection from '@/components/common/FormSection.vue';
import InputError from '@/components/common/InputError.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { unlink } from '@/routes/account/google';

// 10 §13.3, 13 §5.3: Google is connected (Disconnect, `account.google.unlink`, which needs a recent sign-in) or not
// (Connect, the Google redirect with intent `link`). Hidden while Google sign-in is off and nothing is linked. A refusal
// (the last way to sign in) comes back as the error of the `google` field.
defineProps<{ linked: boolean; enabled: boolean }>();

const { t } = useI18n();
const size = useControlSize();
const page = usePage();

const working = ref(false);
const error = computed(() => page.props.errors?.google);

function disconnect(): void {
    router.delete(unlink.url(), {
        preserveScroll: true,
        onStart: () => (working.value = true),
        onFinish: () => (working.value = false),
    });
}
</script>

<template>
    <FormSection
        v-if="enabled || linked"
        :title="t('account.security.google.title')"
        :description="t('account.security.google.description')"
        data-test="google-card"
    >
        <div v-if="linked" class="flex flex-wrap items-center gap-3">
            <Badge variant="success" data-test="google-status">{{
                t('account.security.google.connected')
            }}</Badge>
            <Button
                type="button"
                variant="outline"
                :size="size"
                :disabled="working"
                data-test="google-disconnect"
                @click="disconnect"
            >
                <Spinner v-if="working" />
                {{ t('account.security.google.disconnect') }}
            </Button>
        </div>
        <template v-else>
            <Badge variant="neutral" data-test="google-status">{{
                t('account.security.google.not_connected')
            }}</Badge>
            <GoogleButton intent="link" class="max-w-xs" />
        </template>
        <InputError id="google-error" :message="error" />
    </FormSection>
</template>
