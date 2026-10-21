<?php

declare(strict_types=1);

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The production seeders of 02 §14 in dependency order. Every one is idempotent, so
 * `php artisan db:seed --force` is safe to re-run on each deploy (17 §8).
 */
final class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->call([
            RolesAndPermissionsSeeder::class,
            SettingsSeeder::class,
            TaxRatesSeeder::class,
            CatalogSeeder::class,
            OwnerSeeder::class,
        ]);
    }
}
