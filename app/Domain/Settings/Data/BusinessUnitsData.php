<?php

declare(strict_types=1);

namespace App\Domain\Settings\Data;

use App\Domain\Identity\Enums\UnitSystem;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `business.units` of the shared props (15 §8): the drawing defaults a new user inherits. */
#[TypeScript]
final class BusinessUnitsData extends Data
{
    public function __construct(
        public UnitSystem $defaultSystem,
        public string $defaultLengthUnit,
    ) {}
}
