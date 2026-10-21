<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import RecoveryCodesPanel from '@/components/account/RecoveryCodesPanel.vue';
import OtpCodeField from '@/components/auth/OtpCodeField.vue';
import CopyButton from '@/components/common/CopyButton.vue';
import InputError from '@/components/common/InputError.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/composables/useConfirm';
import { useControlSize } from '@/composables/useControlSize';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { dashboard } from '@/routes/admin';
import { confirm as confirmPassword } from '@/routes/password';
import {
    confirm as confirmCode,
    disable,
    enable,
    qrCode,
    recoveryCodes,
    regenerateRecoveryCodes,
    secretKey,
} from '@/routes/two-factor';

// 11 §18, 13 §5.10 (`TwoFactorPageProps`). The page shows the state; Fortify's routes (behind `password.confirm`) do the
// work: enable, QR code and setup key, confirm with a code, the eight recovery codes, regenerate, disable. Owners and
// admins cannot disable (the server refuses with 403), so the page does not offer it.
const props = defineProps<{
    /** A secret exists: the setup was started, or is done. */
    enabled: boolean;
    /** A code from the authenticator confirmed the secret. */
    confirmed: boolean;
    /** The role must have a confirmed second factor. */
    required: boolean;
    /** `2fa.enrolled` keeps the admin area shut for this user until they confirm. */
    enforced: boolean;
}>();

const { t } = useI18n();
const { confirm } = useConfirm();
const { focusFirstError } = useFocusFirstError();
const size = useControlSize();

// What a Fortify route answers when the password was not confirmed lately (`password.confirm`, JSON clients).
const PASSWORD_CONFIRMATION_REQUIRED = 423;
// The name Fortify gives the error bag of a wrong confirmation code.
const CONFIRM_ERROR_BAG = 'confirmTwoFactorAuthentication';

const settingUp = computed(() => props.enabled && !props.confirmed);

// Whoever is sent here by `2fa.enrolled` goes on to the admin area when they have saved their codes.
const wasEnforced = ref(props.enforced);
watch(
    () => props.enforced,
    (enforced) => {
        wasEnforced.value ||= enforced;
    },
);

const starting = ref(false);
const confirming = ref(false);
const working = ref(false);
const code = ref('');
const errors = ref<Record<string, string>>({});

const qrSource = ref<string | null>(null);
const setupKey = ref<string | null>(null);
const setupFailed = ref(false);
const loadingSetup = ref(false);

const codes = ref<string[] | null>(null);
const codesFailed = ref(false);

/** Fortify's JSON routes. `null` when they could not answer; a stale password confirmation sends the person to confirm it. */
async function getJson<T>(url: string): Promise<T | null> {
    try {
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });

        if (response.status === PASSWORD_CONFIRMATION_REQUIRED) {
            router.visit(confirmPassword.url());

            return null;
        }

        return response.ok ? ((await response.json()) as T) : null;
    } catch {
        return null;
    }
}

async function loadSetup(): Promise<void> {
    loadingSetup.value = true;
    setupFailed.value = false;

    const [qr, key] = await Promise.all([
        getJson<{ svg: string }>(qrCode.url()),
        getJson<{ secretKey: string }>(secretKey.url()),
    ]);

    // An image, never markup: the SVG is shown through `<img>`, which cannot run anything in it.
    qrSource.value =
        qr === null
            ? null
            : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`;
    setupKey.value = key?.secretKey ?? null;
    setupFailed.value = qr === null || key === null;
    loadingSetup.value = false;
}

watch(
    settingUp,
    (setup) => {
        if (setup) {
            void loadSetup();
        }
    },
    { immediate: true },
);

async function showCodes(): Promise<void> {
    const list = await getJson<string[]>(recoveryCodes.url());

    codesFailed.value = list === null;
    codes.value = list;
}

function start(): void {
    router.post(
        enable.url(),
        {},
        {
            preserveScroll: true,
            onStart: () => (starting.value = true),
            onFinish: () => (starting.value = false),
        },
    );
}

function submitCode(): void {
    if (confirming.value || code.value.length !== 6) {
        return;
    }

    router.post(
        confirmCode.url(),
        { code: code.value },
        {
            errorBag: CONFIRM_ERROR_BAG,
            preserveScroll: true,
            onStart: () => {
                confirming.value = true;
                errors.value = {};
            },
            onFinish: () => (confirming.value = false),
            onSuccess: () => {
                code.value = '';
                toast.success(t('account.two_factor.toasts.enabled'));
                void showCodes();
            },
            onError: (refused) => {
                errors.value = refused;
                code.value = '';
                void focusFirstError();
            },
        },
    );
}

async function regenerate(): Promise<void> {
    const confirmed = await confirm({
        title: t('account.two_factor.confirm.regenerate.title'),
        description: t('account.two_factor.confirm.regenerate.description'),
        confirmLabel: t('account.two_factor.confirm.regenerate.action'),
        tone: 'warning',
    });

    if (!confirmed) {
        return;
    }

    router.post(
        regenerateRecoveryCodes.url(),
        {},
        {
            preserveScroll: true,
            onStart: () => (working.value = true),
            onFinish: () => (working.value = false),
            onSuccess: () => {
                toast.success(t('account.two_factor.toasts.regenerated'));
                void showCodes();
            },
        },
    );
}

async function turnOff(): Promise<void> {
    const confirmed = await confirm({
        title: t('account.two_factor.confirm.disable.title'),
        description: t('account.two_factor.confirm.disable.description'),
        confirmLabel: t('account.two_factor.confirm.disable.action'),
        tone: 'destructive',
    });

    if (!confirmed) {
        return;
    }

    router.delete(disable.url(), {
        preserveScroll: true,
        onStart: () => (working.value = true),
        onFinish: () => (working.value = false),
        onSuccess: () => toast.success(t('account.two_factor.toasts.disabled')),
    });
}

function codesDone(): void {
    codes.value = null;

    if (wasEnforced.value) {
        router.visit(dashboard.url());
    }
}
</script>

<template>
    <Head :title="t('account.two_factor.title')" />

    <div class="max-w-2xl space-y-6">
        <PageHeader
            :title="t('account.two_factor.title')"
            :description="t('account.two_factor.description')"
        />

        <Alert v-if="enforced" role="status" data-test="enforced-banner">
            <AlertDescription>{{
                t('account.two_factor.enforced')
            }}</AlertDescription>
        </Alert>

        <Card v-if="codes !== null">
            <CardContent>
                <RecoveryCodesPanel
                    :codes="codes"
                    :done-label="
                        wasEnforced
                            ? t('account.two_factor.codes.continue')
                            : t('account.two_factor.codes.done')
                    "
                    @done="codesDone"
                />
            </CardContent>
        </Card>

        <Alert v-else-if="codesFailed" variant="destructive" role="alert">
            <AlertDescription>{{
                t('account.two_factor.codes.error')
            }}</AlertDescription>
        </Alert>

        <Card v-if="codes === null">
            <CardHeader>
                <CardTitle class="flex items-center gap-2">
                    {{ t('account.two_factor.status.title') }}
                    <Badge :variant="confirmed ? 'success' : 'neutral'">{{
                        confirmed
                            ? t('account.two_factor.status.on')
                            : t('account.two_factor.status.off')
                    }}</Badge>
                </CardTitle>
                <CardDescription>
                    {{
                        confirmed
                            ? t('account.two_factor.status.on_description')
                            : t('account.two_factor.status.off_description')
                    }}
                </CardDescription>
            </CardHeader>

            <CardContent class="space-y-6">
                <Button
                    v-if="!enabled"
                    type="button"
                    :size="size"
                    :disabled="starting"
                    data-test="enable-button"
                    @click="start"
                >
                    <Spinner v-if="starting" />
                    {{ t('account.two_factor.enable') }}
                </Button>

                <div v-if="settingUp" class="space-y-6" data-test="setup">
                    <div class="space-y-3">
                        <p class="text-sm">
                            {{ t('account.two_factor.setup.step_scan') }}
                        </p>

                        <p
                            v-if="loadingSetup"
                            class="text-sm text-muted-foreground"
                            role="status"
                        >
                            {{ t('account.two_factor.setup.qr_loading') }}
                        </p>

                        <div
                            v-else-if="setupFailed"
                            class="space-y-2"
                            role="alert"
                            data-test="qr-error"
                        >
                            <p class="text-sm text-destructive">
                                {{ t('account.two_factor.setup.qr_error') }}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                :size="size"
                                @click="loadSetup"
                            >
                                {{ t('account.two_factor.setup.retry') }}
                            </Button>
                        </div>

                        <template v-else>
                            <!-- White behind the code: a QR code is read dark on light, in either theme. -->
                            <img
                                v-if="qrSource"
                                :src="qrSource"
                                :alt="t('account.two_factor.setup.qr_alt')"
                                width="192"
                                height="192"
                                class="size-48 rounded-lg border bg-white p-2"
                                data-test="qr-code"
                            />

                            <div v-if="setupKey" class="space-y-1">
                                <p class="text-sm text-muted-foreground">
                                    {{
                                        t('account.two_factor.setup.key_label')
                                    }}
                                </p>
                                <div class="flex items-center gap-1">
                                    <code
                                        class="rounded-md bg-muted px-2 py-1 font-mono text-sm break-all select-all"
                                        data-test="setup-key"
                                        >{{ setupKey }}</code
                                    >
                                    <CopyButton
                                        :value="setupKey"
                                        :label="
                                            t(
                                                'account.two_factor.setup.copy_key',
                                            )
                                        "
                                    />
                                </div>
                            </div>
                        </template>
                    </div>

                    <form
                        class="space-y-3"
                        novalidate
                        data-test="confirm-form"
                        @submit.prevent="submitCode"
                    >
                        <p class="text-sm">
                            {{ t('account.two_factor.setup.step_code') }}
                        </p>
                        <div class="grid max-w-xs gap-2">
                            <Label for="code"
                                >{{ t('account.two_factor.setup.code') }}
                                <RequiredMark
                            /></Label>
                            <OtpCodeField
                                id="code"
                                v-model="code"
                                :disabled="confirming"
                                :invalid="Boolean(errors.code)"
                                :describedby="
                                    errors.code ? 'code-error' : undefined
                                "
                            />
                            <InputError
                                id="code-error"
                                :message="errors.code"
                            />
                        </div>
                        <Button
                            type="submit"
                            :size="size"
                            :disabled="confirming || code.length !== 6"
                            data-test="confirm-button"
                        >
                            <Spinner v-if="confirming" />
                            {{ t('account.two_factor.setup.confirm') }}
                        </Button>
                    </form>
                </div>

                <div v-if="confirmed" class="space-y-4">
                    <div class="flex flex-wrap items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            :size="size"
                            :disabled="working"
                            data-test="regenerate-button"
                            @click="regenerate"
                        >
                            {{ t('account.two_factor.manage.regenerate') }}
                        </Button>
                        <span class="text-sm text-muted-foreground">{{
                            t(
                                'account.two_factor.manage.regenerate_description',
                            )
                        }}</span>
                    </div>

                    <p
                        v-if="required"
                        class="text-sm text-muted-foreground"
                        data-test="required-note"
                    >
                        {{ t('account.two_factor.required_note') }}
                    </p>
                    <div v-else class="flex flex-wrap items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            :size="size"
                            :disabled="working"
                            data-test="disable-button"
                            @click="turnOff"
                        >
                            {{ t('account.two_factor.manage.disable') }}
                        </Button>
                        <span class="text-sm text-muted-foreground">{{
                            t('account.two_factor.manage.disable_description')
                        }}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>
</template>
