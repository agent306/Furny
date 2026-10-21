<script setup lang="ts">
import { computed } from 'vue';
import FileDropzone from '@/components/media/FileDropzone.vue';
import type { UploadTarget, UploadedFileRef } from '@/lib/upload';
import type { UploadPurpose } from '@/types';

// 15 §9.11: the dropzone for photos (production, completion, issue, delivery, message images): images only, always
// compressed, shown as a grid of squares.
const props = withDefaults(
    defineProps<{
        purpose: UploadPurpose;
        target?: UploadTarget;
        maxSizeBytes: number;
        maxFiles: number;
        multiple?: boolean;
        disabled?: boolean;
        label?: string;
        hint?: string;
        /** The "Take photo" button on touch devices; on by default. */
        showCamera?: boolean;
        layout?: 'grid' | 'list';
    }>(),
    {
        target: null,
        multiple: undefined,
        label: undefined,
        hint: undefined,
        showCamera: true,
        layout: 'grid',
    },
);

const model = defineModel<UploadedFileRef[]>({ required: true });
const emit = defineEmits<{ uploading: [busy: boolean] }>();

const ACCEPT = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
];
const capture = computed(() => (props.showCamera ? 'environment' : undefined));
</script>

<template>
    <FileDropzone
        v-model="model"
        :purpose="purpose"
        :target="target"
        :accept="ACCEPT"
        :max-size-bytes="maxSizeBytes"
        :max-files="maxFiles"
        :multiple="multiple"
        :disabled="disabled"
        :capture="capture"
        :label="label"
        :hint="hint"
        :layout="layout"
        compress-images
        @uploading="emit('uploading', $event)"
    />
</template>
