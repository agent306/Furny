<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

use App\Support\Settings\Attributes\Encrypted;
use App\Support\Settings\Casts\EncryptedStringCast;
use ReflectionClass;
use ReflectionProperty;
use Spatie\LaravelData\Attributes\MapName;
use Spatie\LaravelData\Data;
use Spatie\LaravelData\Mappers\SnakeCaseMapper;
use Spatie\LaravelData\Support\Transformation\TransformationContextFactory;

/**
 * Base of every `app_settings` group (02 §13). Properties are camelCase; storage keys are
 * snake_case (`MapName`), the wire format is camelCase (11 §12).
 */
#[MapName(SnakeCaseMapper::class)]
abstract class SettingsData extends Data
{
    /** The values a group has when no row (or no field) is stored. */
    abstract public static function defaults(): static;

    /**
     * Property names that are maps (string keys): an empty map is a JSON object `{}`, never `[]`.
     *
     * @return list<string>
     */
    protected static function mapProperties(): array
    {
        return [];
    }

    /**
     * The `app_settings.value` document: snake_case keys, `#[Encrypted]` properties encrypted.
     *
     * @return array<string, mixed>
     */
    public function toStorage(): array
    {
        $storage = $this->toArray();
        $mapper = new SnakeCaseMapper;

        foreach ((new ReflectionClass($this))->getProperties(ReflectionProperty::IS_PUBLIC) as $property) {
            $key = $mapper->map($property->getName());

            if ($property->getAttributes(Encrypted::class) !== [] && array_key_exists($key, $storage)) {
                $storage[$key] = EncryptedStringCast::encrypt($storage[$key]);
            }
        }

        foreach (static::mapProperties() as $name) {
            $key = $mapper->map($name);

            if (($storage[$key] ?? null) === []) {
                $storage[$key] = (object) [];
            }
        }

        return $storage;
    }

    /**
     * The Inertia/JSON props: camelCase keys, nested Data included.
     *
     * @return array<string, mixed>
     */
    public function toWire(): array
    {
        $wire = $this->transform(TransformationContextFactory::create()->withoutPropertyNameMapping());

        foreach (static::mapProperties() as $name) {
            if (($wire[$name] ?? null) === []) {
                $wire[$name] = (object) [];
            }
        }

        return $wire;
    }
}
