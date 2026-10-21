<script setup lang="ts">
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useI18n } from '@/composables/useI18n';

// 10 §4: the wait after too many attempts, counted down on the page. Assistive technology hears the wait once
// when the notice appears; the live countdown is for the eyes only.
const props = defineProps<{ seconds: number }>();

const { t } = useI18n();
const announced = t('auth_ui.throttled', { seconds: props.seconds });
</script>

<template>
    <Alert variant="destructive" data-test="throttle-notice">
        <AlertDescription>
            <span class="sr-only">{{ announced }}</span>
            <span aria-hidden="true">{{
                t('auth_ui.throttled', { seconds })
            }}</span>
        </AlertDescription>
    </Alert>
</template>
