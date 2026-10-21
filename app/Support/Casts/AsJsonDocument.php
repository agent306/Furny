<?php

declare(strict_types=1);

namespace App\Support\Casts;

use App\Support\Json\JsonDocument;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Contracts\Database\Eloquent\ComparesCastableAttributes;
use Illuminate\Database\Eloquent\Model;
use JsonException;

/**
 * Casts a jsonb design-document column to an array with `{}` preserved (02 §12, P1-D13).
 *
 * Reading decodes with {@see JsonDocument::decode()} (empty objects become `stdClass`), writing
 * accepts an array or a JSON string and encodes with {@see JsonDocument::encode()}. A plain array
 * is returned, never an `ArrayObject`, so a document cannot be mutated in place by accident:
 * assign the whole document to change it.
 *
 * @implements CastsAttributes<array<array-key, mixed>|null, array<array-key, mixed>|string|null>
 */
final class AsJsonDocument implements CastsAttributes, ComparesCastableAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     * @return array<array-key, mixed>|null
     *
     * @throws JsonException
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?array
    {
        return $value === null ? null : JsonDocument::decode((string) $value);
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws JsonException
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        return match (true) {
            $value === null => null,
            is_array($value) => JsonDocument::encode($value),
            default => JsonDocument::encode(JsonDocument::decode($value)),
        };
    }

    /**
     * Two stored values are equal when they hold the same document: jsonb re-orders keys and adds
     * spaces, so raw strings are compared after decoding and sorting object keys. `{}` and `[]`
     * stay different.
     */
    public function compare(Model $model, string $key, mixed $firstValue, mixed $secondValue): bool
    {
        if ($firstValue === null || $secondValue === null) {
            return $firstValue === $secondValue;
        }

        return self::canonical((string) $firstValue) === self::canonical((string) $secondValue);
    }

    private static function canonical(string $json): string
    {
        return JsonDocument::encode(self::sortKeys(JsonDocument::decode($json)));
    }

    /**
     * @param  array<array-key, mixed>  $value
     * @return array<array-key, mixed>
     */
    private static function sortKeys(array $value): array
    {
        $value = array_map(static fn (mixed $item): mixed => is_array($item) ? self::sortKeys($item) : $item, $value);

        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }
}
