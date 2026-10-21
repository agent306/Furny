import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadWithIntent } from '@/lib/upload';
import type { UploadError } from '@/lib/upload';

type Reply = { status?: number; body: unknown };

/** An XMLHttpRequest the test drives: it records what was sent and finishes when told to. */
class FakeXhr {
    static instances: FakeXhr[] = [];
    method = '';
    url = '';
    headers: Record<string, string> = {};
    sent: unknown = null;
    aborted = false;
    status = 0;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
        onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;

    constructor() {
        FakeXhr.instances.push(this);
    }

    open(method: string, url: string): void {
        this.method = method;
        this.url = url;
    }

    setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
    }

    send(body: unknown): void {
        this.sent = body;
    }

    abort(): void {
        this.aborted = true;
        this.onabort?.();
    }

    finish(status = 200): void {
        this.status = status;
        this.onload?.();
    }
}

const PRESIGN = {
    uploadId: '01JUPLOAD',
    url: 'https://storage.test/tmp/x',
    headers: { 'Content-Type': 'image/png', 'Content-Length': '3' },
};

let replies: Reply[];
let requests: { url: string; init: RequestInit }[];

function file(): File {
    return new File([new Uint8Array([1, 2, 3])], 'door.png', {
        type: 'image/png',
    });
}

/** Lets the pending fetch/XHR chain run until the next XHR exists. */
async function nextXhr(): Promise<FakeXhr> {
    await vi.waitFor(() => expect(FakeXhr.instances.length).toBeGreaterThan(0));

    return FakeXhr.instances[FakeXhr.instances.length - 1] as FakeXhr;
}

async function rejection(promise: Promise<unknown>): Promise<UploadError> {
    try {
        await promise;
    } catch (error) {
        return error as UploadError;
    }

    throw new Error('Expected the upload to be refused.');
}

beforeEach(() => {
    FakeXhr.instances = [];
    requests = [];
    replies = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init: RequestInit) => {
            requests.push({ url, init });
            const reply = replies.shift() ?? { body: {} };

            return Promise.resolve(
                new Response(JSON.stringify(reply.body), {
                    status: reply.status ?? 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            );
        }),
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('uploadWithIntent (13 §11, 15 §9.10)', () => {
    it('presigns, puts with the returned headers, confirms and polls until ready', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
        replies = [
            { body: PRESIGN },
            { status: 202, body: { uploadId: '01JUPLOAD' } },
            {
                body: {
                    status: 'uploaded',
                    reasonCode: null,
                    previewUrl: null,
                },
            },
            {
                body: {
                    status: 'ready',
                    reasonCode: null,
                    previewUrl: 'https://storage.test/preview',
                },
            },
        ];
        const progress = vi.fn();

        const result = uploadWithIntent(
            file(),
            'production_photo',
            { type: 'order', id: '01JORDER' },
            progress,
            new AbortController().signal,
        );

        const xhr = await nextXhr();
        xhr.upload.onprogress?.({
            lengthComputable: true,
            loaded: 1,
            total: 2,
        } as ProgressEvent);
        xhr.finish();
        await vi.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toEqual({
            uploadId: '01JUPLOAD',
            name: 'door.png',
            size: 3,
            mime: 'image/png',
            previewUrl: 'https://storage.test/preview',
        });

        expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
            purpose: 'production_photo',
            filename: 'door.png',
            size: 3,
            contentType: 'image/png',
            target: { type: 'order', id: '01JORDER' },
        });
        expect(requests.map((request) => request.url)).toEqual([
            '/api/uploads/presign',
            '/api/uploads/01JUPLOAD/confirm',
            '/api/uploads/01JUPLOAD',
            '/api/uploads/01JUPLOAD',
        ]);
        expect(progress).toHaveBeenCalledWith(0.5);
        expect(xhr.method).toBe('PUT');
        expect(xhr.url).toBe(PRESIGN.url);
    });

    it('sends exactly the presigned headers, except the two the browser owns', async () => {
        replies = [
            { body: PRESIGN },
            { status: 202, body: {} },
            { body: { status: 'ready', reasonCode: null, previewUrl: null } },
        ];
        const result = uploadWithIntent(
            file(),
            'avatar',
            null,
            vi.fn(),
            new AbortController().signal,
        );

        const xhr = await nextXhr();
        xhr.finish();
        await result;

        // `Content-Length` is signed but a browser sets it from the body (and refuses to be told).
        expect(xhr.headers).toEqual({ 'Content-Type': 'image/png' });
        expect(xhr.sent).toBeInstanceOf(File);
    });

    it('refuses with the reason code of a rejected upload', async () => {
        replies = [
            { body: PRESIGN },
            { status: 202, body: {} },
            {
                body: {
                    status: 'rejected',
                    reasonCode: 'upload_type_not_allowed',
                    previewUrl: null,
                },
            },
        ];
        const result = uploadWithIntent(
            file(),
            'avatar',
            null,
            vi.fn(),
            new AbortController().signal,
        );
        const failure = rejection(result);

        (await nextXhr()).finish();

        expect((await failure).code).toBe('upload_type_not_allowed');
    });

    it('refuses with the code of a 422 of the presign', async () => {
        replies = [
            { status: 422, body: { code: 'file_too_large', message: 'Big.' } },
        ];

        const failure = await rejection(
            uploadWithIntent(
                file(),
                'avatar',
                null,
                vi.fn(),
                new AbortController().signal,
            ),
        );

        expect([failure.code, failure.message]).toEqual([
            'file_too_large',
            'Big.',
        ]);
        expect(FakeXhr.instances).toHaveLength(0);
    });

    it('cancels the transfer when aborted', async () => {
        replies = [{ body: PRESIGN }];
        const controller = new AbortController();
        const failure = rejection(
            uploadWithIntent(
                file(),
                'avatar',
                null,
                vi.fn(),
                controller.signal,
            ),
        );

        const xhr = await nextXhr();
        controller.abort();

        expect(xhr.aborted).toBe(true);
        expect((await failure).code).toBe('aborted');
    });

    it('gives up after 60 seconds of waiting for the server', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
        replies = [{ body: PRESIGN }, { status: 202, body: {} }];
        for (let i = 0; i < 80; i++) {
            replies.push({
                body: {
                    status: 'uploaded',
                    reasonCode: null,
                    previewUrl: null,
                },
            });
        }
        const failure = rejection(
            uploadWithIntent(
                file(),
                'avatar',
                null,
                vi.fn(),
                new AbortController().signal,
            ),
        );

        (await nextXhr()).finish();
        await vi.advanceTimersByTimeAsync(61_000);

        expect((await failure).code).toBe('timeout');
        // One poll a second: no more than 61 of them.
        expect(requests.length).toBeLessThanOrEqual(2 + 61);
    });

    it('answers a failed transfer with the network code', async () => {
        replies = [{ body: PRESIGN }];
        const failure = rejection(
            uploadWithIntent(
                file(),
                'avatar',
                null,
                vi.fn(),
                new AbortController().signal,
            ),
        );

        (await nextXhr()).onerror?.();

        expect((await failure).code).toBe('network');
    });
});
