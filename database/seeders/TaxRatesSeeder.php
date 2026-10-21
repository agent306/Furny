<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use App\Support\Settings\CatalogVersion;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the Indian GST slabs (02 §14 item 3) and points `pricing.default_tax_rate_id` at GST 18%.
 * Idempotent: rows are matched by name and never modified, and a default tax rate the owner already
 * chose is left alone.
 */
final class TaxRatesSeeder extends Seeder
{
    /** @var list<array{name: string, rate_bps: int, is_default: bool}> */
    private const array RATES = [
        ['name' => 'GST 18%', 'rate_bps' => 1800, 'is_default' => true],
        ['name' => 'GST 12%', 'rate_bps' => 1200, 'is_default' => false],
        ['name' => 'GST 5%', 'rate_bps' => 500, 'is_default' => false],
        ['name' => 'No tax 0%', 'rate_bps' => 0, 'is_default' => false],
    ];

    public function run(): void
    {
        // The rows are written in one transaction with a single version bump (a no-op run bumps nothing).
        DB::transaction(function (): void {
            $created = BumpCatalogVersion::muted(function (): int {
                $created = 0;

                foreach (self::RATES as $rate) {
                    // The unique index allows one default: never claim it from a default the owner already set.
                    $rate['is_default'] = $rate['is_default'] && ! TaxRate::query()->where('is_default', true)->exists();
                    $row = TaxRate::query()->firstOrCreate(['name' => $rate['name']], $rate);
                    $created += $row->wasRecentlyCreated ? 1 : 0;
                }

                return $created;
            });

            if ($created > 0) {
                CatalogVersion::bump();
            }
        });

        // Settings are read after the commit so the cache never holds a value from an open transaction.
        $this->pointDefaultAtGst18();
    }

    private function pointDefaultAtGst18(): void
    {
        $settings = app(Settings::class);
        $pricing = $settings->pricing();

        if ($pricing->defaultTaxRateId !== null) {
            return;
        }

        $pricing->defaultTaxRateId = TaxRate::query()->where('name', 'GST 18%')->value('id');
        $settings->put(SettingsGroup::Pricing, $pricing);
    }
}
