<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * `pricing` (02 §13). `defaultTaxRateId` is filled by `TaxRatesSeeder` (GST 18%).
 */
final class PricingSettings extends SettingsData
{
    public function __construct(
        public bool $pricesIncludeTax,
        public ?string $defaultTaxRateId,
        public int $marginBps,
        public int $overheadBps,
        public int $minimumOrderMinor,
        public int $roundingMinor,
        public string $estimateDisclaimerKey,
        public int $installationBps,
        public int $deliveryFlatMinor,
        public float $kerfMm,
        public int $sheetTrimMm,
        public bool $nestingAllowRotationDefault,
        public string $sheetBillingMode,
        public int $edgePremillMm,
    ) {}

    public static function defaults(): static
    {
        return new self(
            pricesIncludeTax: false,
            defaultTaxRateId: null,
            marginBps: 3500,
            overheadBps: 1000,
            minimumOrderMinor: 0,
            roundingMinor: 100,
            estimateDisclaimerKey: 'estimates.disclaimer',
            installationBps: 800,
            deliveryFlatMinor: 0,
            kerfMm: 4.0,
            sheetTrimMm: 10,
            nestingAllowRotationDefault: true,
            sheetBillingMode: 'used_area',
            edgePremillMm: 0,
        );
    }
}
