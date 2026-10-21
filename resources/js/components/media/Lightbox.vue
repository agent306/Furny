<script setup lang="ts">
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogPortal,
    DialogRoot,
    DialogTitle,
} from 'reka-ui';
import { computed, nextTick, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { MediaData } from '@/types';

// 15 §9.13: the full-screen viewer of a gallery. Arrow keys, Home, End and a horizontal swipe move between photos, a
// double tap zooms to 2x (and the picture can be dragged), Esc or the close button leave, and the focus goes back to
// whatever opened it.
const props = defineProps<{
    photos: MediaData[];
    open: boolean;
    index: number;
}>();

const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:index': [value: number];
}>();

const SWIPE_PX = 50;

const { t } = useI18n();
const zoomed = ref(false);
const pan = ref({ x: 0, y: 0 });
const current = computed(() => props.photos[props.index] ?? null);
const position = computed(() => ({
    index: props.index + 1,
    count: props.photos.length,
}));

function go(to: number): void {
    const clamped = Math.min(Math.max(to, 0), props.photos.length - 1);

    if (clamped !== props.index) {
        emit('update:index', clamped);
    }
}

function onKey(event: KeyboardEvent): void {
    const target = {
        ArrowRight: props.index + 1,
        ArrowLeft: props.index - 1,
        Home: 0,
        End: props.photos.length - 1,
    }[event.key];

    if (target !== undefined) {
        event.preventDefault();
        go(target);
    }
}

// Focus goes back to the thumbnail that had it when the viewer opened.
let opener: HTMLElement | null = null;

watch(
    () => props.open,
    (open) => {
        if (open) {
            opener = document.activeElement as HTMLElement | null;

            return;
        }

        const target = opener;
        opener = null;
        void nextTick(() => target?.focus());
    },
    { immediate: true },
);

// The neighbours are fetched ahead, so a swipe shows a picture at once.
watch(
    () => [props.open, props.index] as const,
    ([open, index]) => {
        zoomed.value = false;
        pan.value = { x: 0, y: 0 };

        if (open) {
            for (const neighbour of [
                props.photos[index - 1],
                props.photos[index + 1],
            ]) {
                if (neighbour !== undefined) {
                    new Image().src = neighbour.largeUrl ?? neighbour.url;
                }
            }
        }
    },
    { immediate: true },
);

let gesture: { x: number; y: number; panX: number; panY: number } | null = null;

function onPointerDown(event: PointerEvent): void {
    gesture = {
        x: event.clientX,
        y: event.clientY,
        panX: pan.value.x,
        panY: pan.value.y,
    };
}

function onPointerMove(event: PointerEvent): void {
    if (zoomed.value && gesture !== null) {
        pan.value = {
            x: gesture.panX + event.clientX - gesture.x,
            y: gesture.panY + event.clientY - gesture.y,
        };
    }
}

function onPointerUp(event: PointerEvent): void {
    if (gesture === null) {
        return;
    }

    const moved = event.clientX - gesture.x;
    gesture = null;

    if (!zoomed.value && Math.abs(moved) >= SWIPE_PX) {
        go(props.index + (moved < 0 ? 1 : -1));
    }
}

function toggleZoom(): void {
    zoomed.value = !zoomed.value;
    pan.value = { x: 0, y: 0 };
}
</script>

<template>
    <DialogRoot :open="open" @update:open="emit('update:open', $event)">
        <DialogPortal>
            <DialogContent
                data-slot="lightbox"
                :aria-roledescription="t('uploads.lightbox.carousel')"
                class="fixed inset-0 z-[60] flex flex-col bg-black/90 text-white outline-none"
                @keydown="onKey"
            >
                <DialogTitle class="sr-only">{{
                    t('uploads.lightbox.title')
                }}</DialogTitle>
                <DialogDescription class="sr-only" aria-live="polite">{{
                    t('uploads.lightbox.announce', position)
                }}</DialogDescription>

                <div class="flex items-center justify-between gap-2 p-3">
                    <p class="text-sm tabular-nums" aria-hidden="true">
                        {{ t('uploads.lightbox.counter', position) }}
                    </p>
                    <div class="flex gap-1">
                        <Button
                            v-if="current"
                            as-child
                            variant="ghost"
                            size="icon-lg"
                            class="text-white hover:bg-white/10 hover:text-white"
                        >
                            <a
                                :href="current.url"
                                download
                                :aria-label="t('uploads.lightbox.download')"
                            >
                                <component
                                    :is="ICONS.download"
                                    aria-hidden="true"
                                />
                            </a>
                        </Button>
                        <DialogClose as-child>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-lg"
                                class="text-white hover:bg-white/10 hover:text-white"
                                :aria-label="t('common.actions.close')"
                            >
                                <component :is="ICONS.x" aria-hidden="true" />
                            </Button>
                        </DialogClose>
                    </div>
                </div>

                <div class="flex min-h-0 flex-1 items-center gap-2 px-2 pb-4">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        class="shrink-0 text-white hover:bg-white/10 hover:text-white"
                        :disabled="index <= 0"
                        :aria-label="t('uploads.lightbox.previous')"
                        @click="go(index - 1)"
                    >
                        <component
                            :is="ICONS['chevron-left']"
                            aria-hidden="true"
                        />
                    </Button>

                    <div
                        class="flex size-full min-w-0 items-center justify-center overflow-hidden"
                        style="touch-action: none"
                        @pointerdown="onPointerDown"
                        @pointermove="onPointerMove"
                        @pointerup="onPointerUp"
                        @dblclick="toggleZoom"
                    >
                        <img
                            v-if="current"
                            :src="current.largeUrl ?? current.url"
                            :alt="
                                current.name ||
                                t('common.photo_n', { n: index + 1 })
                            "
                            draggable="false"
                            class="max-h-full max-w-full object-contain select-none"
                            :style="{
                                transform: zoomed
                                    ? `translate(${pan.x}px, ${pan.y}px) scale(2)`
                                    : undefined,
                            }"
                        />
                    </div>

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        class="shrink-0 text-white hover:bg-white/10 hover:text-white"
                        :disabled="index >= photos.length - 1"
                        :aria-label="t('uploads.lightbox.next')"
                        @click="go(index + 1)"
                    >
                        <component
                            :is="ICONS['chevron-right']"
                            aria-hidden="true"
                        />
                    </Button>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
