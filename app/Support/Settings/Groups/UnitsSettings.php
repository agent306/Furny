<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * `units` (02 §13): drawing defaults in millimetres.
 */
final class UnitsSettings extends SettingsData
{
    public function __construct(
        public string $defaultSystem,
        public string $defaultLengthUnit,
        public int $defaultWallHeightMm,
        public int $defaultExteriorWallThicknessMm,
        public int $defaultInteriorWallThicknessMm,
        public int $defaultDoorWidthMm,
        public int $defaultDoorHeightMm,
        public int $defaultWindowWidthMm,
        public int $defaultWindowHeightMm,
        public int $defaultWindowSillMm,
    ) {}

    public static function defaults(): static
    {
        return new self(
            defaultSystem: 'metric',
            defaultLengthUnit: 'mm',
            defaultWallHeightMm: 2700,
            defaultExteriorWallThicknessMm: 230,
            defaultInteriorWallThicknessMm: 115,
            defaultDoorWidthMm: 900,
            defaultDoorHeightMm: 2100,
            defaultWindowWidthMm: 1200,
            defaultWindowHeightMm: 1200,
            defaultWindowSillMm: 900,
        );
    }
}
