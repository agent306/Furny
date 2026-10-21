<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { Smartphone } from '@lucide/vue';
import { computed } from 'vue';
import GoogleButton from '@/components/auth/GoogleButton.vue';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/composables/useI18n';
import { create } from '@/routes/auth/otp';

// 10 §4.2, §4.3: the other ways in, under the email form: "Use my phone instead" while a code can be sent by WhatsApp
// or SMS (`features.whatsapp || features.sms`), and "Continue with Google" while it is on, behind one "or".
const props = defineProps<{
    /** The page it sits on: the register page's phone button opens the sign-up form. */
    intent: 'login' | 'register';
}>();

const { t } = useI18n();
const page = usePage();
const phone = computed(
    () =>
        page.props.features?.whatsapp === true ||
        page.props.features?.sms === true,
);
const google = computed(() => page.props.features?.google_login === true);
const phoneHref = computed(() =>
    props.intent === 'register'
        ? create({ query: { intent: 'register' } })
        : create(),
);
</script>

<template>
    <div
        v-if="phone || google"
        class="grid gap-3"
        data-test="alternative-sign-in"
    >
        <div
            class="flex items-center gap-3 text-sm text-muted-foreground"
            role="separator"
            data-test="google-separator"
        >
            <span class="h-px flex-1 bg-border" aria-hidden="true" />
            {{ t('auth_ui.google.or') }}
            <span class="h-px flex-1 bg-border" aria-hidden="true" />
        </div>

        <Button
            v-if="phone"
            as-child
            variant="outline"
            size="lg"
            class="w-full"
        >
            <Link :href="phoneHref" data-test="phone-button">
                <Smartphone class="size-5" aria-hidden="true" />
                {{ t('auth_ui.use_phone') }}
            </Link>
        </Button>

        <GoogleButton />
    </div>
</template>
