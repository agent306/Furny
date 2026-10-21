import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressImage } from '@/composables/useImageCompression';

/** The decoded size the stubbed browser reports, and what the canvas encodes (bytes of the result). */
let decoded: { width: number; height: number } | Error;
let encodedBytes: number;
let drawn: {
    width: number;
    height: number;
    fill: string[];
    quality: number | undefined;
};

function stubBrowser(): void {
    drawn = { width: 0, height: 0, fill: [], quality: undefined };
    vi.stubGlobal(
        'createImageBitmap',
        vi.fn(() =>
            decoded instanceof Error
                ? Promise.reject(decoded)
                : Promise.resolve({ ...decoded, close: () => undefined }),
        ),
    );
    vi.stubGlobal(
        'OffscreenCanvas',
        class {
            constructor(
                public width: number,
                public height: number,
            ) {
                drawn.width = width;
                drawn.height = height;
            }

            getContext() {
                return {
                    set fillStyle(value: string) {
                        drawn.fill.push(value);
                    },
                    fillRect: () => undefined,
                    drawImage: () => undefined,
                    imageSmoothingQuality: '',
                };
            }

            convertToBlob(options: { type: string; quality: number }) {
                drawn.quality = options.quality;

                return Promise.resolve(
                    new Blob([new Uint8Array(encodedBytes)], {
                        type: options.type,
                    }),
                );
            }
        },
    );
}

function image(name: string, type: string, bytes: number): File {
    return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
    encodedBytes = 500_000;
    decoded = { width: 4000, height: 3000 };
    stubBrowser();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('compressImage (15 §9.12)', () => {
    it('scales a large photo to 2560 px on the long side and encodes a JPEG', async () => {
        const result = await compressImage(
            image('Holiday.JPEG', 'image/jpeg', 6_000_000),
        );

        expect([drawn.width, drawn.height]).toEqual([2560, 1920]);
        expect(drawn.fill).toContain('#fff');
        expect(drawn.quality).toBe(0.85);
        expect(result.type).toBe('image/jpeg');
        expect(result.name).toBe('Holiday.jpg');
    });

    it('flattens a PNG on white and never scales up', async () => {
        decoded = { width: 1200, height: 900 };

        await compressImage(image('a.png', 'image/png', 6_000_000));

        expect([drawn.width, drawn.height]).toEqual([1200, 900]);
    });

    it('leaves a small JPEG as it is', async () => {
        decoded = { width: 1200, height: 900 };
        const original = image('a.jpg', 'image/jpeg', 1_000_000);

        expect(await compressImage(original)).toBe(original);
    });

    it('leaves what is not an image', async () => {
        const original = image('a.pdf', 'application/pdf', 1_000_000);

        expect(await compressImage(original)).toBe(original);
    });

    it('sends the original when it cannot be decoded (HEIC)', async () => {
        decoded = new Error('The source image cannot be decoded.');
        const original = image('a.heic', 'image/heic', 3_000_000);

        expect(await compressImage(original)).toBe(original);
    });

    it('sends the original when the result is no smaller', async () => {
        encodedBytes = 2_000_000;
        const original = image('a.jpg', 'image/jpeg', 1_800_000);

        expect(await compressImage(original)).toBe(original);
    });
});
