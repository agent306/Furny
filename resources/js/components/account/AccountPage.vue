<script setup lang="ts">
import AccountNav from '@/components/account/AccountNav.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import type { AccountAudience } from '@/lib/account';

// 10 §13.1, 11 §18: the frame of every account page: the heading, the section list and the sections of the page.
withDefaults(
    defineProps<{
        audience: AccountAudience;
        title: string;
        description?: string;
        /** Sections with a rule between them (the forms); `false` for a page of cards, which space themselves. */
        divided?: boolean;
    }>(),
    { description: undefined, divided: true },
);
</script>

<template>
    <div class="space-y-6">
        <PageHeader :title="title" :description="description" />
        <div class="grid grid-cols-1 gap-4 lg:flex lg:gap-10">
            <AccountNav :audience="audience" />
            <div
                :class="
                    divided
                        ? 'min-w-0 flex-1 divide-y'
                        : 'max-w-2xl min-w-0 flex-1 space-y-6'
                "
            >
                <slot />
            </div>
        </div>
    </div>
</template>
