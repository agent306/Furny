<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use GdImage;

/**
 * Decodes an uploaded image with GD, turns it upright, shrinks it and writes it again (13 §11.3 step 3). GD writes no
 * metadata, so EXIF (GPS included), XMP, IPTC, ICC profiles and comments do not survive, and nothing that was hidden in
 * the file does either.
 */
final class ImageSanitizer
{
    /** Decompression bomb guard: the header is read before anything is decoded. */
    public const int MAX_PIXELS = 40_000_000;

    public const int MAX_SIDE = 12_000;

    private const int JPEG_QUALITY = 85;

    private const int WEBP_QUALITY = 85;

    private const int PNG_COMPRESSION = 6;

    private const array IMAGE_TYPES = ['jpeg' => IMAGETYPE_JPEG, 'png' => IMAGETYPE_PNG, 'webp' => IMAGETYPE_WEBP];

    /**
     * `$maxEdge` is the longest edge allowed (never enlarged); with `$square` the middle square is cut out and resized to
     * exactly `$maxEdge` pixels a side (textures).
     *
     * @param  'jpeg'|'png'|'webp'|string  $type
     * @return array{path: string, width: int, height: int} the file written to `$directory` (default: the system's
     *                                                      temporary directory); the caller deletes it
     *
     * @throws UploadRejected `upload_image_too_large`, or `upload_corrupt` when the file is not an image of that type
     */
    public static function sanitize(string $path, string $type, ?int $maxEdge, bool $square = false, ?string $directory = null): array
    {
        if (! isset(self::IMAGE_TYPES[$type])) {
            throw new UploadRejected('upload_corrupt');
        }

        $canvas = self::guardSize($path, $type);

        $frame = $type === 'webp' ? self::firstWebpFrame($path, $directory ?? sys_get_temp_dir()) : null;

        try {
            // GD decodes the frame's own bitstream, whose size the container does not vouch for: it is checked
            // against the same limits, and against the canvas, before anything is decoded.
            if ($frame !== null && ! self::fitsCanvas(self::guardSize($frame, 'webp'), $canvas)) {
                throw new UploadRejected('upload_corrupt');
            }

            $source = self::decode($frame ?? $path, $type);
            $orientation = $type === 'jpeg' ? self::orientation($path) : 1;
        } finally {
            if ($frame !== null) {
                @unlink($frame);
            }
        }

        if ($type !== 'jpeg') {
            // Alpha survives: keep the channel when blending the copies below.
            imagepalettetotruecolor($source);
            imagealphablending($source, false);
            imagesavealpha($source, true);
        }

        // Each step lets go of the picture before it: a 40 megapixel image is 160 MB as true colour.
        $image = self::orient($source, $orientation);
        unset($source);
        $image = self::fit($image, $maxEdge, $square);

        $output = (string) tempnam($directory ?? sys_get_temp_dir(), 'sanitized-');
        $written = match ($type) {
            'jpeg' => self::writeJpeg($image, $output),
            'png' => imagepng($image, $output, self::PNG_COMPRESSION),
            default => imagewebp($image, $output, self::WEBP_QUALITY),
        };

        if (! $written) {
            @unlink($output);

            throw new UploadRejected('upload_corrupt');
        }

        return ['path' => $output, 'width' => imagesx($image), 'height' => imagesy($image)];
    }

    /**
     * From the header only: width x height over 40 MP, or a side over 12 000 px, is refused before any decode.
     *
     * @return array{int, int} width and height
     */
    private static function guardSize(string $path, string $type): array
    {
        $info = self::quietly(static fn (): array|false => getimagesize($path));

        if ($info === false || $info[0] < 1 || $info[1] < 1 || $info[2] !== self::IMAGE_TYPES[$type]) {
            throw new UploadRejected('upload_corrupt');
        }

        if ($info[0] * $info[1] > self::MAX_PIXELS || max($info[0], $info[1]) > self::MAX_SIDE) {
            throw new UploadRejected('upload_image_too_large');
        }

        return [$info[0], $info[1]];
    }

    /**
     * @param  array{int, int}  $frame
     * @param  array{int, int}  $canvas
     */
    private static function fitsCanvas(array $frame, array $canvas): bool
    {
        return $frame[0] <= $canvas[0] && $frame[1] <= $canvas[1];
    }

    private static function decode(string $path, string $type): GdImage
    {
        $image = self::quietly(static fn (): GdImage|false => match ($type) {
            'jpeg' => imagecreatefromjpeg($path),
            'png' => imagecreatefrompng($path),
            default => imagecreatefromwebp($path),
        });

        if ($image === false) {
            throw new UploadRejected('upload_corrupt');
        }

        return $image;
    }

    /** The EXIF Orientation tag (1-8); 1 when there is none or it cannot be read. */
    private static function orientation(string $path): int
    {
        $exif = self::quietly(static fn (): array|false => exif_read_data($path, 'IFD0'));
        $orientation = is_array($exif) ? ($exif['Orientation'] ?? 1) : 1;

        return is_int($orientation) && $orientation >= 1 && $orientation <= 8 ? $orientation : 1;
    }

    /** The pixels as the orientation tag says they should be shown (EXIF 2.32, tag 0x0112). */
    private static function orient(GdImage $image, int $orientation): GdImage
    {
        return match ($orientation) {
            2 => self::flipped($image, IMG_FLIP_HORIZONTAL),
            3 => self::rotated($image, 180),
            4 => self::flipped($image, IMG_FLIP_VERTICAL),
            // Transpose: turn clockwise, then mirror. Transverse: turn counter-clockwise, then mirror.
            5 => self::flipped(self::rotated($image, -90), IMG_FLIP_HORIZONTAL),
            6 => self::rotated($image, -90),
            7 => self::flipped(self::rotated($image, 90), IMG_FLIP_HORIZONTAL),
            8 => self::rotated($image, 90),
            default => $image,
        };
    }

    /** @param  int  $degrees  counter-clockwise, as GD counts */
    private static function rotated(GdImage $image, int $degrees): GdImage
    {
        $rotated = imagerotate($image, $degrees, 0);

        if ($rotated === false) {
            throw new UploadRejected('upload_corrupt');
        }

        return $rotated;
    }

    private static function flipped(GdImage $image, int $mode): GdImage
    {
        imageflip($image, $mode);

        return $image;
    }

    private static function fit(GdImage $image, ?int $maxEdge, bool $square): GdImage
    {
        $width = imagesx($image);
        $height = imagesy($image);

        if ($square) {
            $side = min($width, $height);
            $edge = $maxEdge ?? $side;

            return self::resampled($image, intdiv($width - $side, 2), intdiv($height - $side, 2), $side, $side, $edge, $edge);
        }

        if ($maxEdge === null || max($width, $height) <= $maxEdge) {
            return $image;
        }

        $scale = $maxEdge / max($width, $height);

        return self::resampled($image, 0, 0, $width, $height, max(1, (int) round($width * $scale)), max(1, (int) round($height * $scale)));
    }

    private static function resampled(GdImage $image, int $x, int $y, int $width, int $height, int $newWidth, int $newHeight): GdImage
    {
        $copy = imagecreatetruecolor(max(1, $newWidth), max(1, $newHeight));
        imagealphablending($copy, false);
        imagesavealpha($copy, true);
        imagefill($copy, 0, 0, (int) imagecolorallocatealpha($copy, 0, 0, 0, 127));
        imagecopyresampled($copy, $image, 0, 0, $x, $y, $newWidth, $newHeight, $width, $height);

        return $copy;
    }

    private static function writeJpeg(GdImage $image, string $path): bool
    {
        imageinterlace($image, true);

        return imagejpeg($image, $path, self::JPEG_QUALITY);
    }

    /**
     * GD decodes the first frame of nothing but a still WebP, so the first frame of an animated one is cut out into a
     * file of its own. Null when the file is a still.
     */
    private static function firstWebpFrame(string $path, string $directory): ?string
    {
        $head = (string) file_get_contents($path, false, null, 0, 30);

        // A VP8X chunk whose flags byte (offset 20) has the animation bit.
        if (strlen($head) < 30 || substr($head, 12, 4) !== 'VP8X' || (ord($head[20]) & 0x02) === 0) {
            return null;
        }

        $bytes = (string) file_get_contents($path);
        $offset = 12;
        $end = strlen($bytes);

        while ($offset + 8 <= $end) {
            $size = self::littleEndian($bytes, $offset + 4, 4);

            if (substr($bytes, $offset, 4) === 'ANMF' && $size > 16) {
                // 16 bytes of frame header (position, size, duration, flags), then the frame's own chunks.
                $frame = substr($bytes, $offset + 8 + 16, $size - 16);
                $width = self::littleEndian($bytes, $offset + 8 + 6, 3) + 1;
                $height = self::littleEndian($bytes, $offset + 8 + 9, 3) + 1;

                return self::stillWebp($directory, $frame, $width, $height);
            }

            $offset += 8 + $size + ($size & 1);
        }

        throw new UploadRejected('upload_corrupt');
    }

    /** An unsigned little-endian integer of `$length` bytes (RIFF sizes are 4, frame sizes 3). */
    private static function littleEndian(string $bytes, int $offset, int $length): int
    {
        $value = 0;

        for ($i = $length - 1; $i >= 0; $i--) {
            $value = ($value << 8) | ord($bytes[$offset + $i] ?? "\0");
        }

        return $value;
    }

    /** A WebP file of one frame's chunks; a frame with an alpha chunk needs the extended header to say so. */
    private static function stillWebp(string $directory, string $frame, int $width, int $height): string
    {
        $body = 'WEBP';

        if (str_starts_with($frame, 'ALPH')) {
            $body .= 'VP8X'.pack('V', 10).chr(0x10)."\0\0\0".substr(pack('V', $width - 1), 0, 3).substr(pack('V', $height - 1), 0, 3);
        }

        $body .= $frame;
        $still = (string) tempnam($directory, 'frame-');
        file_put_contents($still, 'RIFF'.pack('V', strlen($body)).$body);

        return $still;
    }

    /**
     * Runs a GD or EXIF call that reports a bad file with a warning as well as with its return value: the warning is
     * dropped, the return value is the answer.
     *
     * @template T
     *
     * @param  callable(): T  $call
     * @return T
     */
    private static function quietly(callable $call): mixed
    {
        set_error_handler(static fn (): bool => true);

        try {
            return $call();
        } finally {
            restore_error_handler();
        }
    }
}
