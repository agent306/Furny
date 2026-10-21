<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * `auth` (02 §13, owner-only). `otpAllowedCountryCodes` is the SMS-pumping allowlist; the seeder
 * derives it from the business address country.
 */
final class AuthSettings extends SettingsData
{
    /**
     * @param  list<string>  $otpAllowedCountryCodes
     */
    public function __construct(
        public bool $allowCustomerRegistration,
        public array $otpAllowedCountryCodes,
        public int $otpGlobalHourlyCap,
        public int $staffSessionAbsoluteHours,
    ) {}

    public static function defaults(): static
    {
        return new self(
            allowCustomerRegistration: true,
            otpAllowedCountryCodes: ['IN'],
            otpGlobalHourlyCap: 200,
            staffSessionAbsoluteHours: 12,
        );
    }
}
