<?php

declare(strict_types=1);

namespace App\Support\Json;

use JsonException;
use stdClass;

/**
 * Lossless JSON codec for design documents (03 §1, P1-D13).
 *
 * PHP arrays cannot tell `{}` from `[]`, so `json_decode(..., true)` would turn every empty record
 * (`"nodes": {}`) into a list and the engine would see `[]` after a round trip. `decode` returns
 * associative arrays for objects with members and a `stdClass` for every empty object; `encode`
 * writes both back unchanged, and keeps `90.0` as `90.0`.
 *
 * Keys of objects are PHP array keys, so a record whose keys are all the integers 0..n-1 in order
 * would encode as a list; document ids are prefixed strings (`n_…`, `w_…`), which rules that out.
 */
final class JsonDocument
{
    private const int ENCODE_FLAGS = JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    /**
     * @return array<array-key, mixed>
     *
     * @throws JsonException on invalid JSON or when the top-level value is not an object or list
     */
    public static function decode(string $json): array
    {
        $decoded = json_decode($json, false, 512, JSON_THROW_ON_ERROR);

        if (! is_array($decoded) && ! $decoded instanceof stdClass) {
            throw new JsonException('A JSON document must be an object or a list.');
        }

        $converted = self::convert($decoded);

        // A top-level `{}` has no array form; documents always carry members, so it reads as empty.
        return $converted instanceof stdClass ? [] : $converted;
    }

    /**
     * @param  array<array-key, mixed>  $doc
     *
     * @throws JsonException
     */
    public static function encode(array $doc): string
    {
        return json_encode($doc, self::ENCODE_FLAGS);
    }

    private static function convert(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_map(self::convert(...), $value);
        }

        if ($value instanceof stdClass) {
            $members = get_object_vars($value);

            return $members === [] ? $value : array_map(self::convert(...), $members);
        }

        return $value;
    }
}
