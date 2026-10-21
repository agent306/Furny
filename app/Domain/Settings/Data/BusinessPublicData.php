<?php

declare(strict_types=1);

namespace App\Domain\Settings\Data;

use App\Domain\Identity\Enums\UnitSystem;
use App\Support\Settings\Groups\BusinessSettings;
use App\Support\Settings\Groups\UnitsSettings;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * The shared prop `business` (15 §8): the public facts of the business, visible to guests. Built
 * field by field; tax id, legal name, address, quote terms and every other settings group stay server side.
 */
#[TypeScript]
final class BusinessPublicData extends Data
{
    /** Used when the business address has no country (15 §8). */
    public const string FALLBACK_COUNTRY_CODE = 'IN';

    public function __construct(
        public string $name,
        /** ISO-4217 */
        public string $currency,
        /** BCP 47, e.g. `en-IN` */
        public string $locale,
        public string $timezone,
        public ?string $phoneE164,
        public string $email,
        public string $workingHours,
        public BusinessUnitsData $units,
        /** ISO 3166-1 alpha-2: `business.address.country_code`, else `IN`. */
        public string $defaultCountryCode,
    ) {}

    public static function fromSettings(BusinessSettings $business, UnitsSettings $units): self
    {
        $country = $business->address['country_code'] ?? null;

        return new self(
            name: $business->name,
            currency: $business->currency,
            locale: $business->locale,
            timezone: $business->timezone,
            phoneE164: $business->phoneE164,
            email: $business->email,
            workingHours: $business->workingHours,
            units: new BusinessUnitsData(
                defaultSystem: UnitSystem::tryFrom($units->defaultSystem) ?? UnitSystem::Metric,
                defaultLengthUnit: $units->defaultLengthUnit,
            ),
            defaultCountryCode: is_string($country) && $country !== '' ? strtoupper($country) : self::FALLBACK_COUNTRY_CODE,
        );
    }
}
