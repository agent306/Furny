<script setup lang="ts">
// 15 §9.31: field error text. Not a live region: the field links to it with
// `aria-describedby="<id>"` and focus moves to the first invalid field.
defineProps<{
    id: string;
    message?: string;
}>();
</script>

<template>
    <p v-if="message" :id="id" class="text-sm text-danger">
        {{ message }}
    </p>
</template>
