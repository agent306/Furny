<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';

// 15 §13: the business logo (max-h 32 px), else the app name as text.
const page = usePage();
</script>

<template>
    <img
        v-if="page.props.app?.logoUrl"
        :src="page.props.app.logoUrl"
        :alt="page.props.app.name"
        class="max-h-8 w-auto"
    />
    <span v-else class="text-xl font-semibold tracking-tight">{{
        page.props.app?.name
    }}</span>
</template>
