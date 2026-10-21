<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\EdgeBand;
use App\Domain\Catalog\Models\Finish;
use App\Domain\Catalog\Models\HardwareItem;
use App\Domain\Catalog\Models\LabourRate;
use App\Domain\Catalog\Models\Material;
use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Catalog\Observers\BumpCatalogVersion;
use App\Domain\Settings\Models\AppSetting;
use App\Support\Settings\Settings;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** 02 §6: every write to a catalog table bumps `catalog.version` once, in the writer's transaction. */
dataset('catalog models', [
    'material' => Material::class,
    'edge band' => EdgeBand::class,
    'hardware item' => HardwareItem::class,
    'finish' => Finish::class,
    'labour rate' => LabourRate::class,
    'tax rate' => TaxRate::class,
]);

dataset('soft-deleting catalog models', [
    'material' => Material::class,
    'edge band' => EdgeBand::class,
    'hardware item' => HardwareItem::class,
    'finish' => Finish::class,
]);

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    AppSetting::query()->delete();
    AppSetting::query()->create(['key' => 'catalog.version', 'value' => 10]);
    Cache::forget('settings:catalog.version');
});

function catalogVersion(): int
{
    return app(Settings::class)->catalogVersion();
}

function storedCatalogVersion(): int
{
    return (int) AppSetting::query()->find('catalog.version')->value;
}

function usesSoftDeletes(string $model): bool
{
    return in_array(SoftDeletes::class, class_uses_recursive($model), true);
}

it('bumps the version by exactly one when creating', function (string $model): void {
    $model::factory()->create();

    expect(storedCatalogVersion())->toBe(11)
        ->and(catalogVersion())->toBe(11);
})->with('catalog models');

it('bumps the version by exactly one when updating', function (string $model): void {
    $row = $model::factory()->create();
    $after = storedCatalogVersion();

    $row->update(['name' => 'Renamed']);

    expect(storedCatalogVersion())->toBe($after + 1);
})->with('catalog models');

it('bumps the version by exactly one when deleting', function (string $model): void {
    $row = $model::factory()->create();
    $after = storedCatalogVersion();

    $row->delete();

    expect(storedCatalogVersion())->toBe($after + 1);
})->with('catalog models');

it('bumps the version by exactly one when restoring a soft-deleted row', function (string $model): void {
    $row = $model::factory()->create();
    $row->delete();
    $after = storedCatalogVersion();

    $row->restore();

    expect(storedCatalogVersion())->toBe($after + 1)
        ->and($row->fresh()->trashed())->toBeFalse();
})->with('soft-deleting catalog models');

it('bumps the version by exactly one when force-deleting', function (string $model): void {
    $row = $model::factory()->create();
    $after = storedCatalogVersion();

    usesSoftDeletes($model) ? $row->forceDelete() : $row->delete();

    expect(storedCatalogVersion())->toBe($after + 1);
})->with('catalog models');

it('bumps once per write, not once per transaction', function (): void {
    DB::transaction(function (): void {
        $material = Material::factory()->create();
        $material->update(['name' => 'Renamed']);
        EdgeBand::factory()->create();
    });

    expect(storedCatalogVersion())->toBe(13);
});

it('leaves the version unchanged when the transaction of a create rolls back', function (string $model): void {
    $before = catalogVersion();
    $rows = $model::query()->count();

    try {
        DB::transaction(function () use ($model): void {
            $model::factory()->create();

            throw new RuntimeException('roll back');
        });
    } catch (RuntimeException) {
        // expected
    }

    expect(storedCatalogVersion())->toBe($before)
        ->and(catalogVersion())->toBe($before)
        ->and($model::query()->count())->toBe($rows);
})->with('catalog models');

it('never reads or caches the version inside the writing transaction, so a rollback cannot poison the cache', function (): void {
    // Cold cache: a read inside the transaction would cache the bumped value and keep it after the rollback.
    expect(Cache::has('settings:catalog.version'))->toBeFalse();

    try {
        DB::transaction(function (): void {
            Material::factory()->create();
            EdgeBand::factory()->create();

            expect(Cache::has('settings:catalog.version'))->toBeFalse();

            throw new RuntimeException('roll back');
        });
    } catch (RuntimeException) {
        // expected
    }

    expect(Cache::has('settings:catalog.version'))->toBeFalse()
        ->and(catalogVersion())->toBe(10);
});

it('busts a cached version once the writing transaction commits', function (): void {
    expect(catalogVersion())->toBe(10);

    DB::transaction(function (): void {
        Material::factory()->create();
    });

    expect(catalogVersion())->toBe(11);
});

it('does not bump while muted and returns the callback result', function (): void {
    $result = BumpCatalogVersion::muted(function (): string {
        Material::factory()->create();
        LabourRate::factory()->create()->delete();

        return 'done';
    });

    expect($result)->toBe('done')
        ->and(storedCatalogVersion())->toBe(10);

    Material::factory()->create();

    expect(storedCatalogVersion())->toBe(11);
});

it('unmutes again when the muted callback throws and supports nesting', function (): void {
    try {
        BumpCatalogVersion::muted(function (): void {
            BumpCatalogVersion::muted(fn () => Material::factory()->create());
            Material::factory()->create();

            throw new RuntimeException('boom');
        });
    } catch (RuntimeException) {
        // expected
    }

    expect(storedCatalogVersion())->toBe(10);

    EdgeBand::factory()->create();

    expect(storedCatalogVersion())->toBe(11);
});

it('does not bump for writes outside the catalog', function (): void {
    AppSetting::query()->create(['key' => 'some.other.key', 'value' => 1]);

    expect(storedCatalogVersion())->toBe(10);
});
