<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import OtpCodeField from '@/components/auth/OtpCodeField.vue';
import InputError from '@/components/common/InputError.vue';
import PhoneInput from '@/components/inputs/PhoneInput.vue';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useControlSize } from '@/composables/useControlSize';
import { useCountdown } from '@/composables/useCountdown';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useI18n } from '@/composables/useI18n';
import { send, verify } from '@/routes/account/phone';

// 10 §13.2.3, 15 §9.31: adds or changes the phone number of the signed-in user. Step 1 is the number and the code
// sent to it (`account.phone.send`; the server picks the channel); step 2 is the code (`account.phone.verify`) with a
// 60 s wait before a new one can be asked for. Verifying toasts `account.toasts.phone_verified` (the flash of the
// response) and emits `verified`. Reused by onboarding, the order submit dialog, the verify-contact banner and the
// staff account pages.
const props = defineProps<{
    open: boolean;
    initialPhone?: string | null;
}>();

const emit = defineEmits<{
    'update:open': [value: boolean];
    verified: [];
}>();

const RESEND_SECONDS = 60;

const { t } = useI18n();
const size = useControlSize();
const page = usePage();
const { focusFirstError } = useFocusFirstError(
    () => document.querySelector('[role="dialog"]') ?? document,
);
const { remaining, restart } = useCountdown();

const step = ref<'phone' | 'code'>('phone');
const phone = ref<string | null>(props.initialPhone ?? null);
const code = ref('');
const sending = ref(false);
const verifying = ref(false);

const errors = computed(() => page.props.errors ?? {});
// A refusal of the send is an error of the `phone` field; a refused code one of `code`, which carries `reason`.
const phoneError = computed(() =>
    errors.value.reason ? undefined : errors.value.phone,
);
const codeError = computed(() =>
    errors.value.reason ? errors.value.code : undefined,
);
const channel = computed(() => page.flash?.channel ?? null);
const masked = computed(() => page.flash?.maskedPhone ?? '');

// Every time the dialog opens it starts over.
watch(
    () => props.open,
    (open) => {
        if (open) {
            step.value = 'phone';
            phone.value = props.initialPhone ?? null;
            code.value = '';
            restart(0);
        }
    },
);

function sendCode(): void {
    if (sending.value || phone.value === null) {
        return;
    }

    router.post(
        send.url(),
        { phone: phone.value },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (sending.value = true),
            onFinish: () => (sending.value = false),
            onSuccess: () => {
                step.value = 'code';
                code.value = '';
                restart(RESEND_SECONDS);
            },
            onError: () => void focusFirstError(),
        },
    );
}

function verifyCode(typed: string): void {
    if (verifying.value || typed.length !== 6) {
        return;
    }

    router.post(
        verify.url(),
        { code: typed },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (verifying.value = true),
            onFinish: () => (verifying.value = false),
            onSuccess: () => {
                emit('verified');
                emit('update:open', false);
            },
            onError: () => {
                code.value = '';
                void focusFirstError();
            },
        },
    );
}

function onOpenChange(value: boolean): void {
    if (!value && (sending.value || verifying.value)) {
        return;
    }

    emit('update:open', value);
}
</script>

<template>
    <Dialog :open="open" @update:open="onOpenChange">
        <DialogContent :show-close-button="false">
            <DialogHeader>
                <DialogTitle>{{ t('account.phone_dialog.title') }}</DialogTitle>
                <DialogDescription>
                    {{ t('account.phone_dialog.description') }}
                </DialogDescription>
            </DialogHeader>

            <form
                v-if="step === 'phone'"
                class="grid gap-4"
                novalidate
                data-test="phone-step"
                @submit.prevent="sendCode"
            >
                <div class="grid gap-2">
                    <Label for="dialog-phone">{{
                        t('account.phone_dialog.phone')
                    }}</Label>
                    <PhoneInput
                        id="dialog-phone"
                        v-model="phone"
                        :disabled="sending"
                        :invalid="Boolean(phoneError)"
                        :aria-describedby="
                            phoneError ? 'dialog-phone-error' : undefined
                        "
                    />
                    <InputError id="dialog-phone-error" :message="phoneError" />
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        :size="size"
                        :disabled="sending"
                        @click="onOpenChange(false)"
                    >
                        {{ t('common.actions.cancel') }}
                    </Button>
                    <Button
                        type="submit"
                        :size="size"
                        :disabled="sending || phone === null"
                        data-test="send-code-button"
                    >
                        <Spinner v-if="sending" />
                        {{ t('account.phone_dialog.send') }}
                    </Button>
                </DialogFooter>
            </form>

            <form
                v-else
                class="grid gap-4"
                novalidate
                data-test="code-step"
                @submit.prevent="verifyCode(code)"
            >
                <p class="text-sm text-muted-foreground" data-test="sent-via">
                    <template v-if="channel">
                        {{ t('account.phone_dialog.sent_via', { channel }) }}
                    </template>
                    {{ t('account.phone_dialog.code_hint', { phone: masked }) }}
                </p>

                <div class="grid gap-2">
                    <Label for="dialog-code">{{
                        t('account.phone_dialog.code')
                    }}</Label>
                    <OtpCodeField
                        id="dialog-code"
                        v-model="code"
                        :disabled="verifying"
                        :invalid="Boolean(codeError)"
                        :describedby="
                            codeError ? 'dialog-code-error' : undefined
                        "
                        @complete="verifyCode"
                    />
                    <InputError id="dialog-code-error" :message="codeError" />
                </div>

                <div class="grid gap-2">
                    <InputError
                        id="dialog-resend-error"
                        :message="phoneError"
                    />
                    <p
                        v-if="remaining > 0"
                        class="text-sm text-muted-foreground"
                        data-test="resend-wait"
                    >
                        {{
                            t('account.phone_dialog.resend_in', {
                                seconds: remaining,
                            })
                        }}
                    </p>
                    <div class="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            :size="size"
                            :disabled="remaining > 0 || sending"
                            data-test="resend-button"
                            @click="sendCode"
                        >
                            {{ t('account.phone_dialog.resend') }}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            :size="size"
                            :disabled="verifying"
                            data-test="change-number"
                            @click="step = 'phone'"
                        >
                            {{ t('account.phone_dialog.change_number') }}
                        </Button>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        :size="size"
                        :disabled="verifying"
                        @click="onOpenChange(false)"
                    >
                        {{ t('common.actions.cancel') }}
                    </Button>
                    <Button
                        type="submit"
                        :size="size"
                        :disabled="verifying || code.length !== 6"
                        data-test="verify-button"
                    >
                        <Spinner v-if="verifying" />
                        {{ t('account.phone_dialog.verify') }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
