<script setup lang="ts">
import InputError from '@/components/common/InputError.vue';
import RichText from '@/components/common/RichText.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { privacy, terms } from '@/routes/legal';

// 10 §4.3, §4.4: "I accept the Terms and the Privacy Policy", required, with the links in a new tab. The field is
// `terms`; its error is shown under it and linked to it.
defineProps<{
    /** The server's error for the field. */
    error?: string;
}>();
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
                <RichText message-key="auth_ui.register.terms">
                    <template #terms="{ text }">
                        <a
                            :href="terms().url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline underline-offset-4"
                            >{{ text }}</a
                        >
                    </template>
                    <template #privacy="{ text }">
                        <a
                            :href="privacy().url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline underline-offset-4"
                            >{{ text }}</a
                        >
                    </template>
                </RichText>
                <RequiredMark />
            </Label>
        </div>
        <InputError id="terms-error" :message="error" />
    </div>
</template>
