<script setup lang="ts">
import { useI18n } from '@/composables/useI18n';
import type { MessageParams } from '@/lib/i18n';

// A translated sentence with markup inside it, as one ICU message: `By going on you accept the <terms>Terms</terms>.`
// The translation owns the words and their order; the page owns what a tag is, one slot for each tag name, given
// the text inside the tag (`<template #terms="{ text }"><a href="…">{{ text }}</a></template>`). A tag without a slot
// is shown as its text.
defineProps<{
    messageKey: string;
    params?: MessageParams;
}>();

const { parts } = useI18n();
</script>

<template>
    <template v-for="(part, index) in parts(messageKey, params)" :key="index">
        <template v-if="typeof part === 'string'">{{ part }}</template>
        <slot v-else :name="part.tag" :text="part.text">{{ part.text }}</slot>
    </template>
</template>
