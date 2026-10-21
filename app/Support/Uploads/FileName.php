<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use Normalizer;

/**
 * The display name of an upload (13 §11.4). Object keys never contain it; it is shown to people and is the file name of
 * a download, so it must hold nothing that changes how it reads (bidi controls) or where it points (path separators).
 */
final class FileName
{
    /** The whole name, extension included. */
    private const int MAX_LENGTH = 100;

    /** Longest extension that is taken for one; anything longer is part of the name. */
    private const int MAX_EXTENSION = 10;

    public static function sanitize(string $name, ?string $canonicalExtension = null): string
    {
        if (! mb_check_encoding($name, 'UTF-8')) {
            $name = mb_convert_encoding($name, 'UTF-8', 'UTF-8');
        }

        $normalised = Normalizer::normalize($name, Normalizer::FORM_C);
        $name = $normalised === false ? $name : $normalised;

        // Only the last path segment, whichever separator it came with.
        $name = str_replace('\\', '/', $name);
        $name = substr($name, (int) strrpos('/'.$name, '/'));

        // Control and format characters (bidi overrides, zero-width), variation selectors (they make emoji), then
        // anything that is not a letter, a mark of a script, a digit or one of ` ._()-`.
        $name = (string) preg_replace(['/\p{C}+/u', '/[\x{FE00}-\x{FE0F}\x{E0100}-\x{E01EF}]/u'], '', $name);
        $name = (string) preg_replace('/[^\p{L}\p{M}\p{N} ._()-]/u', '_', $name);

        // A run of underscores and spaces is one underscore, a run of spaces one space.
        $name = (string) preg_replace(['/[ _]*_[ _]*/u', '/ {2,}/'], ['_', ' '], $name);
        $name = trim($name, ' .');

        [$stem, $extension] = self::split($name);

        if ($canonicalExtension !== null) {
            $extension = strtolower($canonicalExtension);
        }

        $suffix = $extension === '' ? '' : '.'.$extension;
        $stem = rtrim(mb_substr($stem, 0, self::MAX_LENGTH - mb_strlen($suffix)), ' .');

        return ($stem === '' ? 'file' : $stem).$suffix;
    }

    /** @return array{string, string} the name without its extension, and the extension in lower case */
    private static function split(string $name): array
    {
        $dot = strrpos($name, '.');

        if ($dot === false || $dot === 0) {
            return [$name, ''];
        }

        $extension = mb_strtolower(substr($name, $dot + 1));

        if (preg_match('/\A[\p{L}\p{N}]{1,'.self::MAX_EXTENSION.'}\z/u', $extension) !== 1) {
            return [$name, ''];
        }

        return [rtrim(substr($name, 0, $dot), ' .'), $extension];
    }
}
