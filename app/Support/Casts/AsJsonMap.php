<?php

declare(strict_types=1);

namespace App\Support\Casts;

use App\Support\Json\JsonDocument;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Contracts\Database\Eloquent\ComparesCastableAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use JsonException;

/**
 * Casts a `not null default '{}'` jsonb column that holds a string-keyed map (hints, estimate,
 * template default overrides) to an array. The plain `array` cast would write an empty map as
 * `[]`, so the column would flip from its `{}` default to a list; this cast writes `{}` instead.
 *
 * @implements CastsAttributes<array<string, mixed>, mixed>
 */
final class AsJsonMap implements CastsAttributes, ComparesCastableAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): array
    {
        /** @var array<string, mixed> */
        return $value === null ? [] : JsonDocument::decode((string) $value);
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws JsonException
     * @throws InvalidArgumentException when the value is neither an array, a JSON string nor null
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        $map = match (true) {
            $value === null => [],
            is_array($value) => $value,
            is_string($value) => JsonDocument::decode($value),
            default => throw new InvalidArgumentException(sprintf('A JSON map must be an array or a JSON string, %s given.', get_debug_type($value))),
        };

        return $map === [] ? '{}' : JsonDocument::encode($map);
    }

    /**
     * jsonb re-orders keys and adds spaces, so two stored values are equal when they encode the
     * same after decoding and sorting keys. The comparison is strict: `false`, `null`, `0` and
     * `1` vs `1.0` stay different.
     */
    public function compare(Model $model, string $key, mixed $firstValue, mixed $secondValue): bool
    {
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
