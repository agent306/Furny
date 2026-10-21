<script setup lang="ts">
// 15 §10.1: required fields are marked with `*`. It is a typographic mark only: `aria-required` on the control
// tells assistive technology.
const REQUIRED_MARK = '*';
</script>

<template>
    <span aria-hidden="true" class="text-danger">{{ REQUIRED_MARK }}</span>
</template>
