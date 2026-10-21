<?php

declare(strict_types=1);

namespace App\Support\Casts;

use App\Support\Json\JsonDocument;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Contracts\Database\Eloquent\ComparesCastableAttributes;
use Illuminate\Database\Eloquent\Model;
use JsonException;

/**
 * Casts a `not null default '{}'` jsonb column that holds a string-keyed map (hints, estimate,
 * template default overrides) to an array. The plain `array` cast would write an empty map as
 * `[]`, so the column would flip from its `{}` default to a list; this cast writes `{}` instead.
 *
 * @implements CastsAttributes<array<string, mixed>, array<string, mixed>|string|null>
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
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        $map = match (true) {
            $value === null => [],
            is_array($value) => $value,
            default => JsonDocument::decode($value),
        };

        return $map === [] ? '{}' : JsonDocument::encode($map);
    }

    /** jsonb re-orders keys and adds spaces, so values are compared after decoding. */
    public function compare(Model $model, string $key, mixed $firstValue, mixed $secondValue): bool
    {
        return json_decode((string) $firstValue, true) == json_decode((string) $secondValue, true);
    }
}
