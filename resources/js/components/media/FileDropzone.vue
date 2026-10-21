<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed, ref, useId, watch } from 'vue';
import RichText from '@/components/common/RichText.vue';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { useUpload } from '@/composables/useUpload';
import type { UploadItem } from '@/composables/useUpload';
import { ICONS } from '@/lib/icons';
import { mimeOf } from '@/lib/upload';
import type { UploadTarget, UploadedFileRef } from '@/lib/upload';
import type { UploadPurpose } from '@/types';

// 15 §9.10: the dropzone of every browser upload. Validates type, size and count in the browser (the server does it
// again), uploads through the upload-intent flow of 13 §11 and keeps `modelValue` at the references of the files that
// are ready, which the parent form submits as `uploadIds`.
const props = withDefaults(
    defineProps<{
        purpose: UploadPurpose;
        /** What the server authorises the upload against, e.g. the order of a message attachment. */
        target?: UploadTarget;
        /** MIME types; `image/*` style wildcards are fine. */
        accept: string[];
        maxSizeBytes: number;
        maxFiles: number;
        /** Several files at once; by default when more than one file is allowed. */
        multiple?: boolean;
        modelValue: UploadedFileRef[];
        disabled?: boolean;
        /** Adds a "Take photo" button on touch devices. */
        capture?: 'environment' | 'user';
        compressImages?: boolean;
        label?: string;
        hint?: string;
        /** `grid`: square tiles with the progress over the picture (photos). */
        layout?: 'list' | 'grid';
    }>(),
    {
        target: null,
        multiple: undefined,
        capture: undefined,
        label: undefined,
        hint: undefined,
        layout: 'list',
    },
);

const emit = defineEmits<{
    'update:modelValue': [files: UploadedFileRef[]];
    uploading: [busy: boolean];
}>();

const { t, has } = useI18n();
const { formatFileSize } = useFormat();
const ids = useId();
const picker = ref<HTMLInputElement | null>(null);
const camera = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const problems = ref<string[]>([]);
const touch = useMediaQuery('(pointer: coarse)');

const limit = computed(() =>
    (props.multiple ?? props.maxFiles > 1) ? props.maxFiles : 1,
);
const { items, uploading, add, retry, remove, clear } = useUpload({
    purpose: () => props.purpose,
    target: () => props.target,
    compress: () => props.compressImages ?? false,
});

watch(uploading, (busy) => emit('uploading', busy));
watch(
    () =>
        items.value
            .filter((item) => item.ref !== null)
            .map((item) => item.ref as UploadedFileRef),
    (refs) => emit('update:modelValue', refs),
);
// The parent emptied the value (after a submit): start again.
watch(
    () => props.modelValue.length,
    (count) => {
        if (
            count === 0 &&
            items.value.some((item) => item.status === 'ready')
        ) {
            clear();
        }
    },
);

function typeAllowed(file: File): boolean {
    const mime = mimeOf(file);

    return props.accept.some((pattern) =>
        pattern.endsWith('/*')
            ? mime.startsWith(pattern.slice(0, -1))
            : pattern === mime,
    );
}

function take(files: File[]): void {
    if (props.disabled) {
        return;
    }

    problems.value = [];
    let room = limit.value - items.value.length;
    const taken: File[] = [];

    for (const file of files) {
        if (!typeAllowed(file)) {
            problems.value.push(t('uploads.errors.type', { name: file.name }));
        } else if (file.size > props.maxSizeBytes) {
            problems.value.push(
                t('uploads.errors.size', {
                    name: file.name,
                    max: formatFileSize(props.maxSizeBytes),
                }),
            );
        } else if (room <= 0) {
            const message = t('uploads.errors.count', { max: limit.value });

            if (!problems.value.includes(message)) {
                problems.value.push(message);
            }
        } else {
            taken.push(file);
            room -= 1;
        }
    }

    add(taken);
}

function onPick(event: Event): void {
    const input = event.target as HTMLInputElement;

    take(Array.from(input.files ?? []));
    input.value = '';
}

function onDrop(event: DragEvent): void {
    dragging.value = false;
    take(Array.from(event.dataTransfer?.files ?? []));
}

function onPaste(event: ClipboardEvent): void {
    const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
    );

    if (images.length > 0) {
        event.preventDefault();
        take(images);
    }
}

function openPicker(): void {
    if (!props.disabled) {
        picker.value?.click();
    }
}

function statusText(item: UploadItem): string {
    switch (item.status) {
        case 'error':
            return errorText(item);
        case 'uploading':
            return t('uploads.status.uploading', {
                percent: Math.round(item.progress * 100),
            });
        case 'ready':
            return t('uploads.status.ready');
        case 'checking':
            return t('uploads.status.checking');
        default:
            return t('uploads.status.preparing');
    }
}

function errorText(item: UploadItem): string {
    const code = item.error?.code ?? 'failed';
    const key = `uploads.errors.${code}`;

    if (has(key)) {
        return t(key, { max: formatFileSize(props.maxSizeBytes) });
    }

    return item.error?.message ?? t('uploads.errors.failed');
}

function previewOf(item: UploadItem): string | null {
    return item.ref?.previewUrl ?? item.localPreview;
}
</script>

<template>
    <div data-slot="dropzone" class="flex flex-col gap-3">
        <p v-if="label" :id="`${ids}-label`" class="text-sm font-medium">
            {{ label }}
        </p>

        <button
            type="button"
            data-slot="dropzone-area"
            :disabled="disabled"
            :aria-labelledby="label ? `${ids}-label` : undefined"
            :aria-describedby="hint ? `${ids}-hint` : undefined"
            :class="[
                'flex min-h-30 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:min-h-40',
                dragging
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-accent/40',
            ]"
            @click="openPicker"
            @keydown.enter.prevent="openPicker"
            @dragover.prevent="dragging = !disabled"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
            @paste="onPaste"
        >
            <component
                :is="ICONS['upload-cloud']"
                class="size-8 text-muted-foreground"
                aria-hidden="true"
            />
            <span>
                <RichText message-key="uploads.drop_here">
                    <template #browse="{ text }">
                        <span class="font-medium text-primary underline">{{
                            text
                        }}</span>
                    </template>
                </RichText>
            </span>
            <span
                v-if="hint"
                :id="`${ids}-hint`"
                class="text-xs text-muted-foreground"
                >{{ hint }}</span
            >
        </button>

        <input
            ref="picker"
            type="file"
            class="hidden"
            tabindex="-1"
            :accept="accept.join(',')"
            :multiple="multiple ?? maxFiles > 1"
            :disabled="disabled"
            @change="onPick"
        />

        <template v-if="capture && touch">
            <Button
                type="button"
                variant="outline"
                :disabled="disabled"
                @click="camera?.click()"
            >
                <component :is="ICONS.camera" aria-hidden="true" />
                {{ t('uploads.take_photo') }}
            </Button>
            <input
                ref="camera"
                type="file"
                class="hidden"
                tabindex="-1"
                accept="image/*"
                :capture="capture"
                :disabled="disabled"
                @change="onPick"
            />
        </template>

        <ul v-if="problems.length > 0" role="alert" class="flex flex-col gap-1">
            <li
                v-for="problem in problems"
                :key="problem"
                class="text-sm text-danger"
            >
                {{ problem }}
            </li>
        </ul>

        <ul
            v-if="items.length > 0"
            :class="
                layout === 'grid'
                    ? 'grid grid-cols-3 gap-2 md:grid-cols-5'
                    : 'flex flex-col gap-2'
            "
        >
            <li
                v-for="item in items"
                :key="item.key"
                data-slot="upload-item"
                :class="
                    layout === 'grid'
                        ? 'relative aspect-square overflow-hidden rounded-lg border bg-muted'
                        : 'flex items-center gap-3 rounded-lg border p-2'
                "
            >
                <img
                    v-if="previewOf(item)"
                    :src="previewOf(item) ?? undefined"
                    alt=""
                    :class="
                        layout === 'grid'
                            ? 'size-full object-cover'
                            : 'size-10 shrink-0 rounded object-cover'
                    "
                />
                <component
                    :is="ICONS['file-text']"
                    v-else
                    :class="
                        layout === 'grid'
                            ? 'absolute inset-0 m-auto size-8 text-muted-foreground'
                            : 'size-10 shrink-0 p-2 text-muted-foreground'
                    "
                    aria-hidden="true"
                />

                <div
                    :class="
                        layout === 'grid'
                            ? 'absolute inset-x-0 bottom-0 bg-background/80 p-1 text-xs'
                            : 'min-w-0 flex-1'
                    "
                >
                    <p v-if="layout === 'list'" class="truncate text-sm">
                        {{ item.file.name }}
                    </p>
                    <p
                        :class="[
                            'text-xs',
                            item.status === 'error'
                                ? 'text-danger'
                                : 'text-muted-foreground',
                        ]"
                    >
                        <template v-if="layout === 'list'"
                            >{{ formatFileSize(item.file.size) }} ·
                        </template>
                        {{ statusText(item) }}
                    </p>
                    <Progress
                        v-if="item.status === 'uploading'"
                        :model-value="item.progress * 100"
                        class="mt-1 h-1"
                    />
                </div>

                <Button
                    v-if="item.status === 'error'"
                    type="button"
                    data-slot="upload-retry"
                    variant="ghost"
                    size="sm"
                    :class="layout === 'grid' ? 'absolute top-1 left-1' : ''"
                    @click="retry(item)"
                >
                    {{ t('common.actions.retry') }}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    :aria-label="t('uploads.remove', { name: item.file.name })"
                    :class="
                        layout === 'grid'
                            ? 'absolute top-1 right-1 size-7 bg-background/80'
                            : 'shrink-0'
                    "
                    @click="remove(item)"
                >
                    <component :is="ICONS.x" aria-hidden="true" />
                </Button>
            </li>
        </ul>
    </div>
</template>
