import { confirm, presign, show } from '@/routes/api/uploads';
import type { UploadPurpose } from '@/types';

// The browser side of the upload-intent flow (13 §11, 15 §9.10): presign, a PUT of the bytes straight to storage,
// confirm, then poll until the server has checked and processed the file. Every upload in the app goes through here.

export interface UploadedFileRef {
    uploadId: string;
    name: string;
    size: number;
    mime: string;
    /** A signed URL of the processed image once the server has one, otherwise `null`. */
    previewUrl: string | null;
}

export type UploadTarget = { type: string; id: string } | null;

/**
 * Why an upload failed. `code` is a key of `uploads.errors` (the server's refusals, or `network`, `timeout`,
 * `aborted` raised here); `message` is the server's own wording when it sent one.
 */
export class UploadError extends Error {
    constructor(
        readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'UploadError';
    }
}

/** The server answers `ready` or `rejected` within seconds; a minute is long enough to say it took too long (15 §9.10). */
export const POLL_INTERVAL_MS = 1000;
export const POLL_MAX_MS = 60_000;

/** Headers a browser sets itself and refuses to be told (the presign signs `Content-Length` for the storage's sake). */
const BROWSER_OWNED_HEADERS = new Set(['content-length', 'host']);

const EXTENSION_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
    dxf: 'image/vnd.dxf',
};

/** The type a browser reports, or for the files it has no type for (HEIC on some systems) the one the extension says. */
export function mimeOf(file: File): string {
    if (file.type !== '') {
        return file.type;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

    return EXTENSION_TYPES[extension] ?? '';
}

function xsrfToken(): string {
    const cookie = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('XSRF-TOKEN='));

    return cookie === undefined
        ? ''
        : decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
}

async function api(
    url: string,
    signal: AbortSignal,
    body?: unknown,
): Promise<unknown> {
    let response: Response;

    try {
        response = await fetch(url, {
            method: body === undefined ? 'GET' : 'POST',
            credentials: 'same-origin',
            signal,
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-XSRF-TOKEN': xsrfToken(),
                ...(body === undefined
                    ? {}
                    : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new UploadError(signal.aborted ? 'aborted' : 'network');
    }

    const json: unknown = await response.json().catch(() => ({}));
    const fields = (
        typeof json === 'object' && json !== null ? json : {}
    ) as Record<string, unknown>;

    if (!response.ok) {
        throw new UploadError(
            typeof fields.code === 'string' ? fields.code : 'failed',
            typeof fields.message === 'string' ? fields.message : undefined,
        );
    }

    return fields;
}

function put(
    url: string,
    headers: Record<string, string>,
    file: File,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new UploadError('aborted'));

            return;
        }

        const xhr = new XMLHttpRequest();
        const stop = (): void => xhr.abort();

        signal.addEventListener('abort', stop, { once: true });
        xhr.open('PUT', url);

        for (const [name, value] of Object.entries(headers)) {
            if (!BROWSER_OWNED_HEADERS.has(name.toLowerCase())) {
                xhr.setRequestHeader(name, value);
            }
        }

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress(event.loaded / event.total);
            }
        };
        xhr.onload = () => {
            signal.removeEventListener('abort', stop);

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new UploadError('network'));
            }
        };
        xhr.onerror = () => {
            signal.removeEventListener('abort', stop);
            reject(new UploadError('network'));
        };
        xhr.onabort = () => reject(new UploadError('aborted'));
        xhr.send(file);
    });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new UploadError('aborted'));

            return;
        }

        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(new UploadError('aborted'));
        };

        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Uploads one file and resolves with the reference the form submits (`uploadIds`). `onProgress` gets the share of the
 * bytes sent, 0 to 1. Rejects with an `UploadError`; aborting the signal cancels whatever is in flight.
 */
export async function uploadWithIntent(
    file: File,
    purpose: UploadPurpose,
    target: UploadTarget,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
): Promise<UploadedFileRef> {
    if (signal.aborted) {
        throw new UploadError('aborted');
    }

    const mime = mimeOf(file);
    const intent = (await api(presign.url(), signal, {
        purpose,
        filename: file.name,
        size: file.size,
        contentType: mime,
        target,
    })) as App.Domain.Shared.Data.UploadPresignData;

    await put(intent.url, intent.headers, file, onProgress, signal);
    await api(confirm.url(intent.uploadId), signal, {});

    const started = Date.now();

    for (;;) {
        const status = (await api(
            show.url(intent.uploadId),
            signal,
        )) as App.Domain.Shared.Data.UploadIntentStatusData;

        if (status.status === 'ready') {
            return {
                uploadId: intent.uploadId,
                name: file.name,
                size: file.size,
                mime,
                previewUrl: status.previewUrl,
            };
        }

        if (status.status === 'rejected' || status.status === 'expired') {
            throw new UploadError(
                status.reasonCode ??
                    (status.status === 'expired'
                        ? 'upload_expired'
                        : 'upload_processing_failed'),
            );
        }

        if (Date.now() - started >= POLL_MAX_MS) {
            throw new UploadError('timeout');
        }

        await wait(POLL_INTERVAL_MS, signal);
    }
}
