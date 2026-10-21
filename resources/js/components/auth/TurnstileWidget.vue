<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { loadTurnstile } from '@/lib/turnstile';

// 13 §3: Cloudflare Turnstile in managed mode. Nothing is rendered, and nothing is loaded from Cloudflare,
// unless `features.captcha` is on and the page has the public key. The token goes to the server in the hidden
// field `cf_turnstile_response`; the widget lives inside the form it protects.
const props = defineProps<{
    /** The public site key (`turnstileSiteKey` of the page). */
    siteKey: string | null;
    /** The form the token is for: `register`, `password_reset` or `otp_send`. */
    action: string;
}>();

const emit = defineEmits<{ token: [value: string] }>();

const page = usePage();
const active = computed(
    () =>
        page.props.features?.captcha === true &&
        props.siteKey !== null &&
        props.siteKey !== '',
);
const token = ref('');
const container = useTemplateRef<HTMLDivElement>('container');
let widgetId: string | null = null;

function setToken(value: string): void {
    token.value = value;

    if (value !== '') {
        emit('token', value);
    }
}

onMounted(async () => {
    if (!active.value || container.value === null || props.siteKey === null) {
        return;
    }

    try {
        const turnstile = await loadTurnstile();

        // Unmounted while the script was loading.
        if (container.value === null) {
            return;
        }

        widgetId = turnstile.render(container.value, {
            sitekey: props.siteKey,
            action: props.action,
            callback: setToken,
            'expired-callback': () => setToken(''),
            'error-callback': () => setToken(''),
        });
    } catch {
        // Blocked or unreachable: the form is sent without a token and the server decides (fail open or closed).
    }
});

onBeforeUnmount(() => {
    if (widgetId !== null) {
        window.turnstile?.remove(widgetId);
        widgetId = null;
    }
});

/** A token works once: ask for a new one after a failed submit. */
function reset(): void {
    token.value = '';

    if (widgetId !== null) {
        window.turnstile?.reset(widgetId);
    }
}

defineExpose({ reset });
</script>

<template>
    <div v-if="active" data-test="turnstile">
        <div ref="container" />
        <input type="hidden" name="cf_turnstile_response" :value="token" />
    </div>
</template>
