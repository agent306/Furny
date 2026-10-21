<?php

declare(strict_types=1);

namespace App\Support\Uploads;

/**
 * File type from the first bytes of a file (13 §11.3 step 2), never from its name or the browser's MIME type. The types
 * are `jpeg`, `png`, `webp`, `heic`, `pdf` and `dxf`, and `dwg` for the drawing format that must be turned down (06 §2.1).
 */
final class MagicBytes
{
    /** How much of the file the sniffing reads: the PDF marker may sit anywhere in the first KiB. */
    private const int HEAD_BYTES = 1024;

    /** Bytes 8-11 of an `ftyp` box that make a HEIC/HEIF image. */
    private const array HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'];

    private const string BINARY_DXF = "AutoCAD Binary DXF\r\n\x1a\0";

    /**
     * The canonical extension and MIME type of each type, the MIME types a browser may declare for it, and the
     * extensions a person gives it.
     */
    private const array TYPES = [
        'jpeg' => ['extension' => 'jpg', 'mime' => 'image/jpeg', 'declared' => ['image/jpeg'], 'extensions' => ['jpg', 'jpeg']],
        'png' => ['extension' => 'png', 'mime' => 'image/png', 'declared' => ['image/png'], 'extensions' => ['png']],
        'webp' => ['extension' => 'webp', 'mime' => 'image/webp', 'declared' => ['image/webp'], 'extensions' => ['webp']],
        'heic' => ['extension' => 'heic', 'mime' => 'image/heic', 'declared' => ['image/heic', 'image/heif'], 'extensions' => ['heic', 'heif']],
        'pdf' => ['extension' => 'pdf', 'mime' => 'application/pdf', 'declared' => ['application/pdf'], 'extensions' => ['pdf']],
        'dxf' => ['extension' => 'dxf', 'mime' => 'image/vnd.dxf', 'declared' => ['image/vnd.dxf', 'application/dxf', 'application/x-dxf', 'image/x-dxf'], 'extensions' => ['dxf']],
    ];

    /** @return 'jpeg'|'png'|'webp'|'heic'|'pdf'|'dxf'|'dwg'|null */
    public static function detect(string $path): ?string
    {
        $handle = @fopen($path, 'rb');

        if ($handle === false) {
            return null;
        }

        $head = (string) fread($handle, self::HEAD_BYTES);
        fclose($handle);

        return match (true) {
            str_starts_with($head, "\xFF\xD8\xFF") => 'jpeg',
            str_starts_with($head, "\x89PNG\r\n\x1a\n") => 'png',
            strlen($head) >= 12 && str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP' => 'webp',
            strlen($head) >= 12 && substr($head, 4, 4) === 'ftyp' && in_array(substr($head, 8, 4), self::HEIC_BRANDS, true) => 'heic',
            str_starts_with($head, self::BINARY_DXF) => 'dxf',
            // AC1000 and up: AC1002 ... AC1032. The sample versions of 06 §2.1 are all in this range.
            preg_match('/\AAC10\d\d/', $head) === 1 => 'dwg',
            str_contains($head, '%PDF-') => 'pdf',
            // Group code 0, then SECTION, after optional blank lines and a byte order mark.
            preg_match('/\A(?:\xEF\xBB\xBF)?\s*0[ \t]*\r?\n\s*SECTION[ \t]*(?:\r?\n|\z)/', $head) === 1 => 'dxf',
            default => null,
        };
    }

    public static function extension(string $type): string
    {
        return self::TYPES[$type]['extension'];
    }

    public static function mime(string $type): string
    {
        return self::TYPES[$type]['mime'];
    }

    /**
     * The MIME types a browser may declare for the type.
     *
     * @return list<string>
     */
    public static function declaredMimes(string $type): array
    {
        return self::TYPES[$type]['declared'];
    }

    /** The type a declared MIME type stands for; null for a generic one (`application/octet-stream`) or an unknown one. */
    public static function typeOfMime(string $mime): ?string
    {
        foreach (self::TYPES as $type => $description) {
            if (in_array($mime, $description['declared'], true)) {
                return $type;
            }
        }

        return null;
    }

    /** The type a file extension stands for, in any case; null for `dwg` and everything else. */
    public static function typeOfExtension(string $extension): ?string
    {
        $extension = strtolower($extension);

        foreach (self::TYPES as $type => $description) {
            if (in_array($extension, $description['extensions'], true)) {
                return $type;
            }
        }

        return null;
    }
}
