<script setup lang="ts">
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { MediaData } from '@/types';

// 15 §9.31: files as chips with icon, name, size and a download link (the policy-checked `media.show` URL).
defineProps<{ files: MediaData[] }>();

const { t } = useI18n();
const { formatFileSize } = useFormat();
</script>

<template>
    <ul data-slot="attachment-list" class="flex flex-wrap gap-2">
        <li v-for="file in files" :key="file.id">
            <a
                :href="file.url"
                download
                :aria-label="
                    t('uploads.attachment.download', { name: file.name })
                "
                class="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                <component
                    :is="ICONS['file-text']"
                    class="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                />
                <span class="truncate">{{ file.name }}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{{
                    formatFileSize(file.size)
                }}</span>
                <component
                    :is="ICONS.download"
                    class="size-4 shrink-0"
                    aria-hidden="true"
                />
            </a>
        </li>
    </ul>
</template>
