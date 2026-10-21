<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import AppFooter from '@/components/app/AppFooter.vue';
import AppLogo from '@/components/app/AppLogo.vue';
import AppShell from '@/components/app/AppShell.vue';
import { Card } from '@/components/ui/card';
import { welcome } from '@/routes';
import { cn } from '@/lib/utils';

// 15 §7.4: a centered card for the public and authentication pages. `wide`
// (welcome, legal, onboarding) widens it to `max-w-2xl`. `title` / `description`
// fill the card header (the kit's auth pages pass them as layout props, C16);
// pages with their own heading leave them out.
withDefaults(
    defineProps<{
        variant?: 'default' | 'wide';
        title?: string;
        description?: string;
    }>(),
    { variant: 'default', title: undefined, description: undefined },
);
</script>

<template>
    <AppShell variant="customer">
        <div
            class="relative flex min-h-dvh flex-col bg-background lg:bg-brand-wood-subtle"
        >
            <!-- The wood-grain motif (15 §13), full bleed from 1024 px at 6 % opacity. -->
            <svg
                class="pointer-events-none absolute inset-0 hidden size-full opacity-[0.06] lg:block"
                aria-hidden="true"
                focusable="false"
            >
                <defs>
                    <pattern
                        id="auth-grain"
                        width="240"
                        height="120"
                        patternUnits="userSpaceOnUse"
                    >
                        <g
                            fill="none"
                            stroke="var(--brand-wood)"
                            stroke-width="1"
                            transform="rotate(-4 120 60)"
                        >
                            <ellipse cx="120" cy="60" rx="112" ry="52" />
                            <ellipse cx="120" cy="60" rx="80" ry="36" />
                            <ellipse cx="120" cy="60" rx="48" ry="20" />
                        </g>
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#auth-grain)" />
            </svg>

            <main
                id="main"
                tabindex="-1"
                class="relative flex flex-1 items-start justify-center px-4 pt-10 pb-6 outline-none sm:items-center sm:py-10"
            >
                <Card
                    :class="
                        cn(
                            'w-full gap-6 px-4 py-6 max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:shadow-none sm:px-8 sm:py-8',
                            variant === 'wide' ? 'max-w-2xl' : 'max-w-md',
                        )
                    "
                >
                    <div class="flex flex-col items-center gap-4 text-center">
                        <Link
                            :href="welcome()"
                            class="flex min-h-11 items-center rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                            <AppLogo />
                        </Link>
                        <div v-if="title || description" class="space-y-2">
                            <h1
                                v-if="title"
                                tabindex="-1"
                                class="text-2xl font-semibold tracking-tight outline-none"
                            >
                                {{ title }}
                            </h1>
                            <p
                                v-if="description"
                                class="text-sm text-muted-foreground"
                            >
                                {{ description }}
                            </p>
                        </div>
                    </div>
                    <slot />
                    <div v-if="$slots.footer" class="text-center text-sm">
                        <slot name="footer" />
                    </div>
                </Card>
            </main>

            <AppFooter contact class="relative" />
        </div>
    </AppShell>
</template>
