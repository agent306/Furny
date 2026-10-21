<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { ref } from 'vue';
import FormSection from '@/components/common/FormSection.vue';
import RelativeTime from '@/components/display/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/composables/useConfirm';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { destroy, destroyOthers } from '@/routes/account/sessions';
import type { SessionData } from '@/types';

// 10 §13.3, 13 §6.3: the devices that are signed in. Each can be signed out; the one in use is marked, and signing it
// out ends this session. "Sign out all other devices" asks first and needs a recent sign-in (`recent.auth`).
defineProps<{ sessions: SessionData[] }>();

const { t } = useI18n();
const { confirm } = useConfirm();
const size = useControlSize();

const working = ref<string | null>(null);

const OTHERS = 'others';

function signOut(session: SessionData): void {
    router.delete(destroy.url(session.id), {
        preserveScroll: true,
        onStart: () => (working.value = session.id),
        onFinish: () => (working.value = null),
    });
}

async function signOutOthers(): Promise<void> {
    const confirmed = await confirm({
        title: t('account.security.devices.sign_out_others_title'),
        description: t('account.security.devices.sign_out_others_body'),
        confirmLabel: t('account.security.devices.sign_out_others'),
        tone: 'warning',
    });

    if (!confirmed) {
        return;
    }

    router.delete(destroyOthers.url(), {
        preserveScroll: true,
        onStart: () => (working.value = OTHERS),
        onFinish: () => (working.value = null),
    });
}

const METHODS = ['password', 'otp', 'google', 'remember'];

function method(session: SessionData): string {
    return t('account.security.devices.method', {
        method: METHODS.includes(session.method) ? session.method : 'other',
    });
}
</script>

<template>
    <FormSection
        :title="t('account.security.devices.title')"
        :description="t('account.security.devices.description')"
    >
        <ul class="divide-y rounded-lg border" data-test="sessions">
            <li
                v-for="session in sessions"
                :key="session.id"
                class="flex flex-wrap items-center gap-3 p-3"
                :data-test="session.isCurrent ? 'session-current' : 'session'"
            >
                <div class="min-w-0 flex-1 space-y-0.5">
                    <p class="flex flex-wrap items-center gap-2 font-medium">
                        <span class="break-words">{{ session.uaSummary }}</span>
                        <Badge v-if="session.isCurrent" variant="primary">{{
                            t('account.security.devices.this_device')
                        }}</Badge>
                    </p>
                    <p class="text-sm text-muted-foreground">
                        {{ session.ipMasked }} · {{ method(session) }} ·
                        <RelativeTime :at="session.lastActiveAt" />
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    :size="size"
                    :disabled="working !== null"
                    :aria-label="
                        t('account.security.devices.sign_out_label', {
                            device: session.uaSummary,
                        })
                    "
                    data-test="sign-out"
                    @click="signOut(session)"
                >
                    {{ t('account.security.devices.sign_out') }}
                </Button>
            </li>
        </ul>
        <Button
            v-if="sessions.some((session) => !session.isCurrent)"
            type="button"
            variant="outline"
            :size="size"
            :disabled="working !== null"
            data-test="sign-out-others"
            @click="signOutOthers"
        >
            {{ t('account.security.devices.sign_out_others') }}
        </Button>
    </FormSection>
</template>
