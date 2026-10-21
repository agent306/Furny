<script setup lang="ts">
import AccountNav from '@/components/account/AccountNav.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import type { AccountAudience } from '@/lib/account';

// 10 §13.1, 11 §18: the frame of every account page: the heading, the section list and the sections of the page.
defineProps<{
    audience: AccountAudience;
    title: string;
    description?: string;
}>();
</script>

<template>
    <div class="space-y-6">
        <PageHeader :title="title" :description="description" />
        <div class="grid gap-4 lg:flex lg:gap-10">
            <AccountNav :audience="audience" />
            <div class="min-w-0 flex-1 divide-y">
                <slot />
            </div>
        </div>
    </div>
</template>
