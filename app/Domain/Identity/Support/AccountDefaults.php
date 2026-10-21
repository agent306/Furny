<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Support\Settings\Settings;

/**
 * What every new account starts with, customer or staff: the business time zone, the business drawing units and
 * the application's language (13 §5.1, §5.9). The one place that reads these defaults from the business settings, so
 * registration and the acceptance of a staff invitation cannot drift apart.
 */
final class AccountDefaults
{
    public function __construct(private readonly Settings $settings) {}

    /**
     * @return array{timezone: string, unit_system: UnitSystem, length_unit: LengthUnit, locale: string}
     */
    public function attributes(): array
    {
        $units = $this->settings->units();

        return [
            'timezone' => $this->settings->business()->timezone,
            'unit_system' => UnitSystem::from($units->defaultSystem),
            'length_unit' => LengthUnit::from($units->defaultLengthUnit),
            'locale' => (string) config('app.locale'),
        ];
    }
}
