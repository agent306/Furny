<script setup lang="ts">
import { useId } from 'vue';

// 15 §9.31: settings/edit pages. From 1024 px the description sits in the left
// third and the fields in the right two thirds; below, they stack.
defineProps<{
    title: string;
    description?: string;
}>();

const headingId = useId();
</script>

<template>
    <section
        :aria-labelledby="headingId"
        class="grid gap-4 py-6 lg:grid-cols-3 lg:gap-8"
    >
        <div class="space-y-1">
            <h2 :id="headingId" class="text-base font-semibold">{{ title }}</h2>
            <p v-if="description" class="text-sm text-muted-foreground">
                {{ description }}
            </p>
        </div>
        <div class="space-y-4 lg:col-span-2">
            <slot />
        </div>
    </section>
</template>
