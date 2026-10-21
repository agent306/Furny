// Client-side image compression (15 §9.12): a phone photo is shrunk before it is uploaded, so the declared size is the
// size that is sent. Re-encoding drops EXIF (GPS included), which is meant.
const MAX_EDGE = 2560;
const MAX_UNCHANGED_BYTES = 1.5 * 1024 * 1024;
const QUALITY = 0.85;

/**
 * The file to upload for `file`: a JPEG of at most 2560 px on the long side, or the original when it is not an image,
 * cannot be decoded here (HEIC; the server converts it), is small enough already or would come out larger.
 */
export async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) {
        return file;
    }

    let bitmap: ImageBitmap;

    try {
        // 'from-image' applies the EXIF rotation that re-encoding would otherwise lose.
        bitmap = await createImageBitmap(file, {
            imageOrientation: 'from-image',
        });
    } catch {
        return file;
    }

    try {
        const longest = Math.max(bitmap.width, bitmap.height);

        if (
            longest <= MAX_EDGE &&
            file.type === 'image/jpeg' &&
            file.size <= MAX_UNCHANGED_BYTES
        ) {
            return file;
        }

        const scale = Math.min(1, MAX_EDGE / longest);
        const width = Math.round(bitmap.width * scale);
        const height = Math.round(bitmap.height * scale);
        // shortcut: OffscreenCanvas only (spec 15 §9.12 also names a <canvas> fallback), add one if older Safari matters.
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');

        if (context === null) {
            return file;
        }

        // White under the picture: a transparent PNG would turn black as a JPEG.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, width, height);

        const blob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: QUALITY,
        });

        if (blob.size >= file.size) {
            return file;
        }

        return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', {
            type: 'image/jpeg',
            lastModified: file.lastModified,
        });
    } catch {
        // Whatever goes wrong while shrinking, the original still uploads.
        return file;
    } finally {
        bitmap.close();
    }
}
