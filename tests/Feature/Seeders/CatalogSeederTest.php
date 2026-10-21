<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\EdgeBand;
use App\Domain\Catalog\Models\Finish;
use App\Domain\Catalog\Models\HardwareItem;
use App\Domain\Catalog\Models\LabourRate;
use App\Domain\Catalog\Models\Material;
use App\Domain\Settings\Models\AppSetting;
use App\Support\Settings\Settings;
use Database\Seeders\CatalogSeeder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    foreach (['materials', 'edge_bands', 'hardware_items', 'finishes', 'labour_rates'] as $table) {
        DB::table($table)->delete();
    }

    AppSetting::query()->delete();
    AppSetting::query()->create(['key' => 'catalog.version', 'value' => 1]);
    Cache::flush();
    unset($_SERVER['FORCE_CATALOG_SEED'], $_ENV['FORCE_CATALOG_SEED']);
});

afterEach(function (): void {
    unset($_SERVER['FORCE_CATALOG_SEED'], $_ENV['FORCE_CATALOG_SEED']);
});

function seedCatalog(): void
{
    app(CatalogSeeder::class)->run();
}

it('seeds the starter catalog counts of 08 §7', function (): void {
    seedCatalog();

    expect(Material::query()->count())->toBe(12)
        ->and(EdgeBand::query()->count())->toBe(8)
        ->and(HardwareItem::query()->count())->toBe(40)
        ->and(Finish::query()->count())->toBe(6)
        ->and(LabourRate::query()->count())->toBe(14);
});

it('seeds the materials of 08 §7.1', function (): void {
    seedCatalog();

    $oak = Material::query()->where('code', 'PB18-OAK')->firstOrFail();
    $glass = Material::query()->where('code', 'GLASS5-CLEAR')->firstOrFail();

    expect($oak->has_grain)->toBeTrue()
        ->and($oak->price_per_sheet_minor)->toBe(265000)
        ->and($oak->waste_factor)->toBe('0.120')
        ->and($oak->default_edge_band_code)->toBe('EB08-OAK')
        ->and($oak->sort_order)->toBe(20)
        ->and($oak->thickness_mm)->toBe('18.0')
        ->and($oak->usage)->toBe(['carcass', 'shelf', 'front', 'top', 'plinth'])
        ->and($glass->board_type->value)->toBe('glass')
        ->and($glass->sheet_width_mm)->toBe(1830)
        ->and($glass->sheet_length_mm)->toBe(2440)
        ->and($glass->usage)->toBe(['glass'])
        ->and(Material::query()->orderBy('sort_order')->pluck('sort_order')->all())->toBe(range(10, 120, 10))
        ->and(Material::query()->whereNotNull('default_edge_band_code')->pluck('default_edge_band_code')->unique()->diff(EdgeBand::query()->pluck('code'))->all())->toBe([]);
});

it('seeds the edge bands of 08 §7.2', function (): void {
    seedCatalog();

    $band = EdgeBand::query()->where('code', 'EB10-WHITE-28')->firstOrFail();

    expect($band->thickness_mm)->toBe('1.00')
        ->and($band->width_mm)->toBe(28)
        ->and($band->price_per_meter_minor)->toBe(1000)
        ->and(EdgeBand::query()->where('code', 'EB04-WHITE')->value('price_per_meter_minor'))->toBe(300);
});

it('seeds the hardware of 08 §7.3', function (): void {
    seedCatalog();

    $hinge = HardwareItem::query()->where('code', 'HNG-FO-SC')->firstOrFail();
    $slide = HardwareItem::query()->where('code', 'SLD-BB-600')->firstOrFail();
    $undermount = HardwareItem::query()->where('code', 'SLD-UM-450')->firstOrFail();
    $led = HardwareItem::query()->where('code', 'LED-STRIP-12V')->firstOrFail();

    expect($hinge->price_minor)->toBe(12000)
        ->and($hinge->specs['overlay'])->toBe('full')
        ->and($hinge->is_default_for)->toBe(['hinge.full_overlay'])
        ->and($slide->unit->value)->toBe('pair')
        ->and($slide->price_minor)->toBe(65000)
        ->and($slide->specs['lengthMm'])->toBe(600)
        ->and($slide->is_default_for)->toBe([])
        ->and($undermount->is_default_for)->toBe(['slide.undermount'])
        ->and($led->unit->value)->toBe('meter')
        ->and(HardwareItem::query()->where('code', 'SLD-BB-450')->value('is_default_for'))->toBe(['slide.side_mount']);
});

it('assigns hardware sort order as row number times ten', function (): void {
    seedCatalog();

    $ordered = HardwareItem::query()->orderBy('sort_order')->get();

    expect($ordered->first()->sort_order)->toBe(10)
        ->and($ordered->first()->code)->toBe('HNG-FO-SC')
        ->and($ordered->last()->sort_order)->toBe(400)
        ->and($ordered->last()->code)->toBe('LED-STRIP-12V')
        ->and($ordered->pluck('sort_order')->all())->toBe(range(10, 400, 10));
});

it('assigns every default role key of 07 §6.11 to exactly one hardware item', function (): void {
    seedCatalog();

    $keys = HardwareItem::query()->get()->flatMap(fn (HardwareItem $item): array => $item->is_default_for);

    expect($keys)->toHaveCount(28)
        ->and($keys->unique())->toHaveCount(28);
});

it('stores spec-less hardware as an empty JSON object, never a list', function (): void {
    seedCatalog();

    $raw = DB::table('hardware_items')->where('code', 'LED-STRIP-12V')->value('specs');

    expect($raw)->toBe('{}')
        ->and(HardwareItem::query()->where('code', 'LED-STRIP-12V')->firstOrFail()->specs)->toBe([]);
});

it('seeds the finishes of 08 §7.4', function (): void {
    seedCatalog();

    $gloss = Finish::query()->where('code', 'FIN-PU-GLOSS')->firstOrFail();

    expect($gloss->price_per_sqm_minor)->toBe(160000)
        ->and($gloss->applies_to)->toBe(['mdf'])
        ->and($gloss->finish_type->value)->toBe('pu')
        ->and(Finish::query()->where('code', 'FIN-VENEER-TEAK')->value('color_hex'))->toBe('#A0703C');
});

it('seeds the labour rates of 08 §7.5', function (): void {
    seedCatalog();

    $installation = LabourRate::query()->where('key', 'installation_per_item')->firstOrFail();

    expect($installation->rate_minor)->toBe(150000)
        ->and($installation->unit->value)->toBe('item')
        ->and(LabourRate::query()->orderBy('key')->pluck('key')->all())->toBe([
            'assembly_per_part', 'cutting_per_sheet', 'drawer_assembly_each', 'drilling_per_hole', 'edge_banding_per_meter',
            'finishing_per_sqm', 'general_per_hour', 'glass_fitting_each', 'hardware_fitting_each', 'hinge_cup_boring_each',
            'hinge_install_each', 'installation_per_item', 'packing_per_item', 'sliding_door_fitting_each',
        ]);
});

it('is idempotent, keeps owner edits and bumps catalog.version once per run', function (): void {
    seedCatalog();

    expect(app(Settings::class)->catalogVersion())->toBe(2);

    HardwareItem::query()->where('code', 'HNG-FO-SC')->firstOrFail()->update(['price_minor' => 99900]);
    Material::query()->where('code', 'PB18-WHITE')->firstOrFail()->delete();
    $before = AppSetting::query()->find('catalog.version')->value;

    seedCatalog();

    expect(Material::query()->withTrashed()->count())->toBe(12)
        ->and(Material::query()->count())->toBe(11)
        ->and(EdgeBand::query()->count())->toBe(8)
        ->and(HardwareItem::query()->count())->toBe(40)
        ->and(Finish::query()->count())->toBe(6)
        ->and(LabourRate::query()->count())->toBe(14)
        ->and(HardwareItem::query()->where('code', 'HNG-FO-SC')->value('price_minor'))->toBe(99900)
        ->and(AppSetting::query()->find('catalog.version')->value)->toBe($before + 1)
        ->and(app(Settings::class)->catalogVersion())->toBe($before + 1);
});

it('resets every starter row when FORCE_CATALOG_SEED is true', function (): void {
    seedCatalog();
    HardwareItem::query()->where('code', 'HNG-FO-SC')->firstOrFail()->update(['price_minor' => 99900, 'is_default_for' => []]);
    Material::query()->where('code', 'PB18-WHITE')->firstOrFail()->delete();
    LabourRate::query()->where('key', 'cutting_per_sheet')->firstOrFail()->update(['rate_minor' => 1]);
    $_SERVER['FORCE_CATALOG_SEED'] = 'true';

    seedCatalog();

    expect(HardwareItem::query()->where('code', 'HNG-FO-SC')->value('price_minor'))->toBe(12000)
        ->and(HardwareItem::query()->where('code', 'HNG-FO-SC')->firstOrFail()->is_default_for)->toBe(['hinge.full_overlay'])
        ->and(Material::query()->where('code', 'PB18-WHITE')->count())->toBe(1)
        ->and(LabourRate::query()->where('key', 'cutting_per_sheet')->value('rate_minor'))->toBe(15000)
        ->and(Material::query()->withTrashed()->count())->toBe(12)
        ->and(HardwareItem::query()->count())->toBe(40);
});

it('does not reset starter rows for any other FORCE_CATALOG_SEED value', function (): void {
    seedCatalog();
    HardwareItem::query()->where('code', 'HNG-FO-SC')->firstOrFail()->update(['price_minor' => 99900]);
    $_SERVER['FORCE_CATALOG_SEED'] = 'false';

    seedCatalog();

    expect(HardwareItem::query()->where('code', 'HNG-FO-SC')->value('price_minor'))->toBe(99900);
});

it('warns that the starter prices need review', function (): void {
    $this->artisan('db:seed', ['--class' => CatalogSeeder::class])
        ->expectsOutputToContain('Review the starter catalog prices')
        ->assertSuccessful();
});

it('skips a starter row that already exists with an owner-edited value', function (): void {
    DB::table('labour_rates')->insert([
        'id' => (string) Str::ulid(), 'key' => 'cutting_per_sheet', 'name' => 'x', 'unit' => 'sheet', 'rate_minor' => 1,
        'created_at' => now(), 'updated_at' => now(),
    ]);
    seedCatalog();

    expect(LabourRate::query()->count())->toBe(14)
        ->and(LabourRate::query()->where('key', 'cutting_per_sheet')->value('rate_minor'))->toBe(1);
});
