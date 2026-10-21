<script setup lang="ts">
import { computed, ref } from 'vue';
import Lightbox from '@/components/media/Lightbox.vue';
import { useI18n } from '@/composables/useI18n';
import type { MediaData } from '@/types';

// 15 §9.13: a grid of thumbnails; a click opens the Lightbox on that photo. With `max`, the rest hide behind a "+N"
// tile that opens the Lightbox on the first of them.
const props = withDefaults(
    defineProps<{
        photos: MediaData[];
        columns?: { base: number; md: number; lg: number };
        aspect?: 'square' | '4/3' | 'auto';
        max?: number;
    }>(),
    {
        columns: () => ({ base: 2, md: 3, lg: 4 }),
        aspect: 'square',
        max: undefined,
    },
);

const { t } = useI18n();
const open = ref(false);
const index = ref(0);
const visible = computed(() =>
    props.max === undefined ? props.photos : props.photos.slice(0, props.max),
);
const hidden = computed(() => props.photos.length - visible.value.length);

const ASPECT = { square: 'aspect-square', '4/3': 'aspect-[4/3]', auto: '' };

function show(at: number): void {
    index.value = at;
    open.value = true;
}
</script>

<template>
    <div
        data-slot="photo-gallery"
        class="grid grid-cols-(--cols-base) gap-2 md:grid-cols-(--cols-md) lg:grid-cols-(--cols-lg)"
        :style="{
            '--cols-base': columns.base,
            '--cols-md': columns.md,
            '--cols-lg': columns.lg,
        }"
    >
        <button
            v-for="(photo, at) in visible"
            :key="photo.id"
            type="button"
            data-slot="gallery-thumb"
            :class="[
                'overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                ASPECT[aspect],
            ]"
            @click="show(at)"
        >
            <img
                :src="photo.thumbUrl ?? photo.url"
                :alt="photo.name || t('common.photo_n', { n: at + 1 })"
                loading="lazy"
                decoding="async"
                :class="[
                    'size-full',
                    aspect === 'auto' ? 'h-auto' : 'object-cover',
                ]"
            />
        </button>

        <button
            v-if="hidden > 0"
            type="button"
            data-slot="gallery-more"
            :aria-label="t('uploads.gallery.more', { count: hidden })"
            :class="[
                'flex items-center justify-center rounded-lg bg-muted text-lg font-semibold text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                aspect === 'auto' ? 'aspect-square' : ASPECT[aspect],
            ]"
            @click="show(visible.length)"
        >
            +{{ hidden }}
        </button>

        <Lightbox v-model:open="open" v-model:index="index" :photos="photos" />
    </div>
</template>
