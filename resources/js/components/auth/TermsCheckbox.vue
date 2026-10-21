<script setup lang="ts">
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/composables/useI18n';
import { privacy, terms } from '@/routes/legal';

// 10 §4.3, §4.4: "I accept the Terms and the Privacy Policy", required, with the links in a new tab. The field is
// `terms`; its error is shown under it and linked to it.
defineProps<{
    /** The server's error for the field. */
    error?: string;
}>();

const { t } = useI18n();
</script>

<template>
    <div class="grid gap-2">
        <div class="flex items-start gap-3">
            <Checkbox
                id="terms"
                name="terms"
                class="mt-0.5"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="error ? 'terms-error' : undefined"
            />
            <Label
                for="terms"
                class="block text-sm leading-relaxed font-normal"
            >
                {{ t('auth_ui.register.terms_before') }}
                <a
                    :href="terms().url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline underline-offset-4"
                    >{{ t('legal.terms.title') }}</a
                >
                {{ t('auth_ui.register.terms_and') }}
                <a
                    :href="privacy().url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline underline-offset-4"
                    >{{ t('legal.privacy.title') }}</a
                >
                <RequiredMark />
            </Label>
        </div>
        <InputError id="terms-error" :message="error" />
    </div>
</template>
