<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Catalog\Models\EdgeBand;
use App\Domain\Catalog\Models\Finish;
use App\Domain\Catalog\Models\HardwareItem;
use App\Domain\Catalog\Models\LabourRate;
use App\Domain\Catalog\Models\Material;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use App\Support\Settings\CatalogVersion;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Seeder;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the starter catalog of 08 §7 from `database/seeders/data/catalog.php` (02 §14 item 4).
 *
 * Idempotent: a row is matched by `code` (`key` for labour rates) and, when it exists, left exactly
 * as the owner last edited it (archived rows stay archived). `FORCE_CATALOG_SEED=true` resets every
 * starter row to its seed values instead. Every run bumps `catalog.version` exactly once, and warns
 * that the prices are placeholders.
 */
final class CatalogSeeder extends Seeder
{
    public function run(): void
    {
        /** @var array<string, list<array<string, mixed>>> $data */
        $data = require database_path('seeders/data/catalog.php');
        $force = filter_var(Env::get('FORCE_CATALOG_SEED', false), FILTER_VALIDATE_BOOLEAN);

        DB::transaction(function () use ($data, $force): void {
            BumpCatalogVersion::muted(function () use ($data, $force): void {
                $this->seed(Material::withTrashed(), 'code', $data['materials'], $force);
                $this->seed(EdgeBand::withTrashed(), 'code', $data['edge_bands'], $force);
                $this->seed(HardwareItem::withTrashed(), 'code', $this->withSortOrder($data['hardware']), $force);
                $this->seed(Finish::withTrashed(), 'code', $data['finishes'], $force);
                $this->seed(LabourRate::query(), 'key', $data['labour_rates'], $force);
            });

            CatalogVersion::bump();
        });

        $this->command?->warn('Review the starter catalog prices: they are placeholders until the owner edits them in Admin > Catalog.');
    }

    /**
     * Hardware `sort_order` is the row number x 10 (08 §7.3).
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function withSortOrder(array $rows): array
    {
        return array_map(
            static fn (array $row, int $index): array => $row + ['sort_order' => ($index + 1) * 10],
            $rows,
            array_keys($rows),
        );
    }

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query  every row of the table, archived ones included
     * @param  list<array<string, mixed>>  $rows
     */
    private function seed(Builder $query, string $identity, array $rows, bool $force): void
    {
        foreach ($rows as $row) {
            $existing = (clone $query)->where($identity, $row[$identity])->first();

            if ($existing === null) {
                $query->getModel()->newQuery()->create($row);
            } elseif ($force) {
                $existing->fill($row);

                if (in_array(SoftDeletes::class, class_uses_recursive($existing), true)) {
                    $existing->forceFill(['deleted_at' => null]);
                }

                $existing->save();
            }
        }
    }
}
