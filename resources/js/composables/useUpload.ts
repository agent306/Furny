import { computed, onScopeDispose, reactive, ref } from 'vue';
import { compressImage } from '@/composables/useImageCompression';
import { UploadError, uploadWithIntent } from '@/lib/upload';
import type { UploadTarget, UploadedFileRef } from '@/lib/upload';
import type { UploadPurpose } from '@/types';

export type UploadItemStatus =
    'waiting' | 'preparing' | 'uploading' | 'checking' | 'ready' | 'error';

export interface UploadItem {
    key: number;
    file: File;
    status: UploadItemStatus;
    /** Share of the bytes sent, 0 to 1. */
    progress: number;
    /** A local preview of an image while the server has none. */
    localPreview: string | null;
    ref: UploadedFileRef | null;
    error: { code: string; message: string | null } | null;
}

const BUSY: UploadItemStatus[] = [
    'waiting',
    'preparing',
    'uploading',
    'checking',
];

/**
 * The files of one dropzone, each on its way through `uploadWithIntent` (15 §9.10). They go one after the other: it
 * bounds the memory the compression of phone photos takes (15 §9.12). A failed item stays in the list until it is
 * retried or removed.
 */
export function useUpload(options: {
    purpose: () => UploadPurpose;
    target: () => UploadTarget;
    compress: () => boolean;
    maxSizeBytes: () => number;
}) {
    const items = ref<UploadItem[]>([]);
    const controllers = new Map<number, AbortController>();
    let queue: Promise<void> = Promise.resolve();
    let nextKey = 0;

    const uploading = computed(() =>
        items.value.some((item) => BUSY.includes(item.status)),
    );

    function preview(file: File): string | null {
        return file.type.startsWith('image/') &&
            typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(file)
            : null;
    }

    async function run(item: UploadItem): Promise<void> {
        if (!items.value.includes(item)) {
            return; // removed while it was waiting
        }

        const controller = new AbortController();
        controllers.set(item.key, controller);
        item.status = 'preparing';
        item.progress = 0;
        item.error = null;

        try {
            const file = options.compress()
                ? await compressImage(item.file)
                : item.file;

            // The size that counts is the one that is sent (15 §9.10): a photo may be over the limit until it is shrunk.
            if (file.size > options.maxSizeBytes()) {
                item.status = 'error';
                item.error = { code: 'file_too_large', message: null };

                return;
            }

            item.status = 'uploading';
            item.ref = await uploadWithIntent(
                file,
                options.purpose(),
                options.target(),
                (fraction) => {
                    item.progress = fraction;
                    item.status = fraction >= 1 ? 'checking' : 'uploading';
                },
                controller.signal,
            );
            item.status = 'ready';
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }

            const known = error instanceof UploadError;
            item.status = 'error';
            item.error = {
                code: known ? error.code : 'failed',
                message:
                    known && error.message !== error.code
                        ? error.message
                        : null,
            };
        } finally {
            controllers.delete(item.key);
        }
    }

    function enqueue(item: UploadItem): void {
        item.status = 'waiting';
        queue = queue.then(() => run(item));
    }

    function add(files: File[]): void {
        for (const file of files) {
            const item = reactive<UploadItem>({
                key: nextKey++,
                file,
                status: 'waiting',
                progress: 0,
                localPreview: preview(file),
                ref: null,
                error: null,
            });

            items.value.push(item);
            enqueue(item);
        }
    }

    function release(item: UploadItem): void {
        controllers.get(item.key)?.abort();

        if (item.localPreview !== null) {
            URL.revokeObjectURL(item.localPreview);
        }
    }

    function remove(item: UploadItem): void {
        release(item);
        items.value = items.value.filter((candidate) => candidate !== item);
    }

    function clear(): void {
        items.value.forEach(release);
        items.value = [];
    }

    onScopeDispose(clear);

    return { items, uploading, add, retry: enqueue, remove, clear };
}
