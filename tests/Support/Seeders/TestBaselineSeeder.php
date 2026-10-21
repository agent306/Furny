<?php

declare(strict_types=1);

namespace Tests\Support\Seeders;

use Database\Seeders\CatalogSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Database\Seeders\SettingsSeeder;
use Database\Seeders\TaxRatesSeeder;
use Illuminate\Database\Seeder;

/**
 * Baseline data of every test database (16 §4.1): the production seeders 1-4 of 02 §14.
 * No owner and no demo data; tests that need other rows build them with factories.
 */
final class TestBaselineSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            RolesAndPermissionsSeeder::class,
            SettingsSeeder::class,
            TaxRatesSeeder::class,
            CatalogSeeder::class,
        ]);
    }
}
