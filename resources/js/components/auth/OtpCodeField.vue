<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { Input } from '@/components/ui/input';

// 13 §4.4: one field for the 6-digit code, with what lets the phone fill it in: `inputmode="numeric"`,
// `autocomplete="one-time-code"` (iOS and Android suggest the code from the message), and WebOTP on browsers that
// have it (Chrome on Android reads the SMS that ends with `@host #code`). `complete` is emitted as soon as six digits
// are there, typed, pasted, suggested or read from the SMS, so that the page can submit them.
const props = defineProps<{
    id: string;
    modelValue: string;
    name?: string;
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
    complete: [code: string];
}>();

const CODE_LENGTH = 6;

const input = useTemplateRef<{ $el: HTMLInputElement }>('input');
let abort: AbortController | null = null;

function set(value: string): void {
    // Digits only: a code pasted as "123 456" or typed with a dash is still the code.
    const digits = value.replace(/\D+/g, '').slice(0, CODE_LENGTH);

    emit('update:modelValue', digits);

    if (input.value !== null) {
        input.value.$el.value = digits;
    }

    if (digits.length === CODE_LENGTH && digits !== props.modelValue) {
        emit('complete', digits);
    }
}

type WebOtpCredential = Credential & { code?: string };
type WebOtpOptions = CredentialRequestOptions & {
    otp: { transport: string[] };
};

onMounted(() => {
    if (!('OTPCredential' in window) || !navigator.credentials) {
        return;
    }

    abort = new AbortController();
    const options: WebOtpOptions = {
        otp: { transport: ['sms'] },
        signal: abort.signal,
    };

    navigator.credentials
        .get(options)
        .then((credential) => {
            const code = (credential as WebOtpCredential | null)?.code;

            if (typeof code === 'string' && code !== '') {
                set(code);
            }
        })
        .catch(() => {
            // Refused by the person, aborted or not available: the field works as it is.
        });
});

onBeforeUnmount(() => {
    abort?.abort();
    abort = null;
});

defineExpose({ focus: () => input.value?.$el.focus() });
</script>

<template>
    <Input
        :id="id"
        ref="input"
        :name="name ?? 'code'"
        :model-value="modelValue"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        maxlength="6"
        size="lg"
        required
        aria-required="true"
        :disabled="disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedby"
        class="text-center font-mono text-xl tracking-[0.5em]"
        data-test="otp-code"
        @update:model-value="set(String($event))"
    />
</template>
