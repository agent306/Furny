<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Settings\Models\AppSetting;
use App\Support\Settings\Groups\PricingSettings;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Database\Seeders\TaxRatesSeeder;
use Illuminate\Support\Facades\Cache;

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    TaxRate::query()->delete();
    AppSetting::query()->delete();
    Cache::flush();
});

function seedTaxRates(): void
{
    app(TaxRatesSeeder::class)->run();
}

it('seeds the four GST slabs with GST 18% as the default', function (): void {
    seedTaxRates();

    expect(TaxRate::query()->orderByDesc('rate_bps')->get(['name', 'rate_bps', 'is_default', 'is_active'])->map->only(['name', 'rate_bps', 'is_default', 'is_active'])->all())
        ->toBe([
            ['name' => 'GST 18%', 'rate_bps' => 1800, 'is_default' => true, 'is_active' => true],
            ['name' => 'GST 12%', 'rate_bps' => 1200, 'is_default' => false, 'is_active' => true],
            ['name' => 'GST 5%', 'rate_bps' => 500, 'is_default' => false, 'is_active' => true],
            ['name' => 'No tax 0%', 'rate_bps' => 0, 'is_default' => false, 'is_active' => true],
        ]);
});

it('is idempotent', function (): void {
    seedTaxRates();
    $ids = TaxRate::query()->orderBy('name')->pluck('id')->all();

    seedTaxRates();

    expect(TaxRate::query()->count())->toBe(4)
        ->and(TaxRate::query()->orderBy('name')->pluck('id')->all())->toBe($ids)
        ->and(TaxRate::query()->where('is_default', true)->count())->toBe(1);
});

it('does not touch rates the owner edited', function (): void {
    seedTaxRates();
    TaxRate::query()->where('name', 'GST 12%')->firstOrFail()->update(['rate_bps' => 1250, 'is_active' => false]);

    seedTaxRates();

    expect(TaxRate::query()->where('name', 'GST 12%')->firstOrFail()->only(['rate_bps', 'is_active']))
        ->toBe(['rate_bps' => 1250, 'is_active' => false]);
});

it('points pricing.default_tax_rate_id at GST 18% when it is null', function (): void {
    seedTaxRates();

    $gst18 = TaxRate::query()->where('name', 'GST 18%')->firstOrFail();

    expect(app(Settings::class)->pricing()->defaultTaxRateId)->toBe($gst18->id)
        ->and(AppSetting::query()->find('pricing')->value['default_tax_rate_id'])->toBe($gst18->id);
});

it('leaves a non-null default tax rate alone', function (): void {
    $other = TaxRate::factory()->create(['name' => 'Custom 3%', 'rate_bps' => 300]);
    $pricing = PricingSettings::defaults();
    $pricing->defaultTaxRateId = $other->id;
    app(Settings::class)->put(SettingsGroup::Pricing, $pricing);

    seedTaxRates();

    expect(app(Settings::class)->pricing()->defaultTaxRateId)->toBe($other->id);
});

it('does not claim the default flag when another rate already holds it', function (): void {
    TaxRate::factory()->default()->create(['name' => 'Custom 3%', 'rate_bps' => 300]);

    seedTaxRates();

    expect(TaxRate::query()->where('is_default', true)->pluck('name')->all())->toBe(['Custom 3%'])
        ->and(TaxRate::query()->count())->toBe(5);
});

it('bumps the catalog version once when it creates rates and not at all on a re-run', function (): void {
    AppSetting::query()->create(['key' => 'catalog.version', 'value' => 1]);

    seedTaxRates();

    expect(AppSetting::query()->find('catalog.version')->value)->toBe(2);

    seedTaxRates();

    expect(AppSetting::query()->find('catalog.version')->value)->toBe(2);
});
