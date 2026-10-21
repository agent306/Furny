<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * `business` (02 §13). `address` is an address-shape array (`line1`, `city`, `country_code`, …).
 */
final class BusinessSettings extends SettingsData
{
    /**
     * @param  array<string, mixed>|null  $address
     */
    public function __construct(
        public string $name,
        public ?string $legalName,
        public ?string $taxId,
        public string $email,
        public ?string $phoneE164,
        public ?array $address,
        public string $currency,
        public string $locale,
        public string $timezone,
        public ?int $logoMediaId,
        public string $quoteTerms,
        public string $workingHours,
    ) {}

    public static function defaults(): static
    {
        return new self(
            name: (string) config('app.name'),
            legalName: null,
            taxId: null,
            email: (string) config('mail.from.address'),
            phoneE164: null,
            address: null,
            currency: 'INR',
            locale: 'en-IN',
            timezone: 'Asia/Kolkata',
            logoMediaId: null,
            quoteTerms: trans_icu('quotes.default_terms'),
            workingHours: 'Mon–Sat 10:00–19:00',
        );
    }
}
