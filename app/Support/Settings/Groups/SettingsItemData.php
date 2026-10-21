<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

use Spatie\LaravelData\Attributes\MapName;
use Spatie\LaravelData\Data;
use Spatie\LaravelData\Mappers\SnakeCaseMapper;

/**
 * Base of the objects nested inside a settings group: snake_case in storage, camelCase properties
 * and wire (the generated TypeScript types describe `SettingsData::toWire()`).
 */
#[MapName(SnakeCaseMapper::class)]
abstract class SettingsItemData extends Data {}
