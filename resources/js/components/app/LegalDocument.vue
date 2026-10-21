<script setup lang="ts">
import { computed } from 'vue';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';

// A legal page body (10 §4.9): paragraphs of plain text. `body` is the
// translated message with `{business}` already filled in; it is split on blank
// lines and every paragraph is printed as text, never as HTML.
const props = defineProps<{
    title: string;
    body: string;
    /** ISO date of the last update. */
    updatedOn: string;
}>();

const { t } = useI18n();
const { formatDate } = useFormat();

const paragraphs = computed(() =>
    props.body
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== ''),
);
</script>

<template>
    <article class="mx-auto w-full max-w-prose space-y-4">
        <header class="space-y-1">
            <h1
                tabindex="-1"
                class="text-2xl font-semibold tracking-tight outline-none"
            >
                {{ title }}
            </h1>
            <p class="text-sm text-muted-foreground">
                {{
                    t('legal.last_updated', {
                        date: formatDate(updatedOn, 'long'),
                    })
                }}
            </p>
        </header>
        <p
            v-for="(paragraph, index) in paragraphs"
            :key="index"
            class="leading-relaxed"
        >
            {{ paragraph }}
        </p>
    </article>
</template>
