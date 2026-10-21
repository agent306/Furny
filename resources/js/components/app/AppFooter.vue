<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { privacy, terms } from '@/routes/legal';

// 15 §7.1 / §7.4. `contact` adds the business hours, phone and email (the
// public pages); the customer layout shows the copyright and legal links only.
defineProps<{
    contact?: boolean;
}>();

const { t } = useI18n();
const page = usePage();
const business = computed(() => page.props.business);
const year = new Date().getFullYear();
</script>

<template>
    <footer class="text-sm text-muted-foreground">
        <div
            class="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8"
        >
            <div class="space-y-1">
                <p>
                    {{
                        t('common.footer.copyright', {
                            year,
                            business: business?.name ?? '',
                        })
                    }}
                </p>
                <ul
                    v-if="contact && business"
                    data-test="business-contact"
                    class="flex flex-wrap gap-x-4 gap-y-1"
                >
                    <li v-if="business.workingHours">
                        {{ business.workingHours }}
                    </li>
                    <li v-if="business.phoneE164">
                        <a
                            :href="`tel:${business.phoneE164}`"
                            class="underline-offset-4 hover:underline"
                            >{{ business.phoneE164 }}</a
                        >
                    </li>
                    <li v-if="business.email">
                        <a
                            :href="`mailto:${business.email}`"
                            class="underline-offset-4 hover:underline"
                            >{{ business.email }}</a
                        >
                    </li>
                </ul>
            </div>
            <ul class="flex gap-4">
                <li>
                    <Link
                        :href="terms()"
                        class="inline-flex min-h-11 items-center underline-offset-4 hover:underline md:min-h-0"
                        >{{ t('common.footer.terms') }}</Link
                    >
                </li>
                <li>
                    <Link
                        :href="privacy()"
                        class="inline-flex min-h-11 items-center underline-offset-4 hover:underline md:min-h-0"
                        >{{ t('common.footer.privacy') }}</Link
                    >
                </li>
            </ul>
        </div>
    </footer>
</template>
