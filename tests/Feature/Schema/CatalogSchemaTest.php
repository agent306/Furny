<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\Material;
use App\Domain\Catalog\Models\TaxRate;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\PgSchema;

/**
 * 02 §6.1–§6.6 and §15 group 5.
 */
it('creates materials with the columns of 02 §6.1', function (): void {
    expect(PgSchema::columns('materials'))->toBe(PgSchema::sorted([
        'id', 'code', 'name', 'board_type', 'thickness_mm', 'sheet_length_mm', 'sheet_width_mm', 'has_grain', 'decor_name',
        'color_hex', 'surface', 'price_per_sheet_minor', 'waste_factor', 'density_kg_m3', 'usage', 'default_edge_band_code',
        'is_active', 'sort_order', 'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('materials', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('materials', 'code'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'name'))->toMatchArray(['character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'board_type'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'thickness_mm'))->toMatchArray(['data_type' => 'numeric', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'sheet_length_mm'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'sheet_width_mm'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'has_grain'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'decor_name'))->toMatchArray(['character_maximum_length' => 120, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('materials', 'color_hex'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 7, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('materials', 'surface'))->toMatchArray(['character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'price_per_sheet_minor'))->toMatchArray(['data_type' => 'bigint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'waste_factor'))->toMatchArray(['data_type' => 'numeric', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'density_kg_m3'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('materials', 'usage'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'default_edge_band_code'))->toMatchArray(['character_maximum_length' => 40, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('materials', 'is_active'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'sort_order'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('materials', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('materials', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz']);

    $precision = DB::selectOne("select numeric_precision, numeric_scale from information_schema.columns where table_schema = current_schema() and table_name = 'materials' and column_name = 'thickness_mm'");
    $waste = DB::selectOne("select numeric_precision, numeric_scale from information_schema.columns where table_schema = current_schema() and table_name = 'materials' and column_name = 'waste_factor'");

    expect([$precision->numeric_precision, $precision->numeric_scale])->toBe([5, 1])
        ->and([$waste->numeric_precision, $waste->numeric_scale])->toBe([4, 3]);
});

it('defaults materials as in 02 §6.1', function (): void {
    expect(PgSchema::column('materials', 'waste_factor')['column_default'])->toContain('0.100')
        ->and(PgSchema::column('materials', 'surface')['column_default'])->toContain("'melamine'")
        ->and(PgSchema::column('materials', 'has_grain')['column_default'])->toBe('false')
        ->and(PgSchema::column('materials', 'is_active')['column_default'])->toBe('true')
        ->and(PgSchema::column('materials', 'sort_order')['column_default'])->toBe('0')
        ->and(PgSchema::column('materials', 'usage')['column_default'])->toContain('["carcass", "shelf", "front", "back", "top"]');
});

it('creates edge_bands with the columns of 02 §6.2', function (): void {
    expect(PgSchema::columns('edge_bands'))->toBe(PgSchema::sorted([
        'id', 'code', 'name', 'thickness_mm', 'width_mm', 'color_hex', 'price_per_meter_minor', 'is_active',
        'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('edge_bands', 'code'))->toMatchArray(['character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('edge_bands', 'name'))->toMatchArray(['character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('edge_bands', 'thickness_mm'))->toMatchArray(['data_type' => 'numeric', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('edge_bands', 'width_mm'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('edge_bands', 'color_hex'))->toMatchArray(['character_maximum_length' => 7, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('edge_bands', 'price_per_meter_minor'))->toMatchArray(['data_type' => 'bigint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('edge_bands', 'is_active')['column_default'])->toBe('true')
        ->and(PgSchema::column('edge_bands', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);

    $thickness = DB::selectOne("select numeric_precision, numeric_scale from information_schema.columns where table_schema = current_schema() and table_name = 'edge_bands' and column_name = 'thickness_mm'");

    expect([$thickness->numeric_precision, $thickness->numeric_scale])->toBe([4, 2]);
});

it('creates hardware_items with the columns of 02 §6.3', function (): void {
    expect(PgSchema::columns('hardware_items'))->toBe(PgSchema::sorted([
        'id', 'code', 'name', 'category', 'specs', 'unit', 'price_minor', 'is_default_for', 'is_active', 'sort_order',
        'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('hardware_items', 'code'))->toMatchArray(['character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'name'))->toMatchArray(['character_maximum_length' => 160, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'category'))->toMatchArray(['character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'specs'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'unit'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'price_minor'))->toMatchArray(['data_type' => 'bigint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'is_default_for'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('hardware_items', 'is_default_for')['column_default'])->toContain("'[]'")
        ->and(PgSchema::column('hardware_items', 'is_active')['column_default'])->toBe('true')
        ->and(PgSchema::column('hardware_items', 'sort_order')['column_default'])->toBe('0')
        ->and(PgSchema::column('hardware_items', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('creates finishes with the columns of 02 §6.4', function (): void {
    expect(PgSchema::columns('finishes'))->toBe(PgSchema::sorted([
        'id', 'code', 'name', 'finish_type', 'price_per_sqm_minor', 'applies_to', 'color_hex', 'is_active',
        'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('finishes', 'code'))->toMatchArray(['character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('finishes', 'name'))->toMatchArray(['character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('finishes', 'finish_type'))->toMatchArray(['character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('finishes', 'price_per_sqm_minor'))->toMatchArray(['data_type' => 'bigint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('finishes', 'applies_to'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('finishes', 'color_hex'))->toMatchArray(['character_maximum_length' => 7, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('finishes', 'is_active')['column_default'])->toBe('true')
        ->and(PgSchema::column('finishes', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('creates labour_rates with the columns of 02 §6.5 and no soft deletes', function (): void {
    expect(PgSchema::columns('labour_rates'))->toBe(PgSchema::sorted([
        'id', 'key', 'name', 'unit', 'rate_minor', 'is_active', 'created_at', 'updated_at',
    ]))
        ->and(PgSchema::column('labour_rates', 'key'))->toMatchArray(['character_maximum_length' => 48, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('labour_rates', 'name'))->toMatchArray(['character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('labour_rates', 'unit'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('labour_rates', 'rate_minor'))->toMatchArray(['data_type' => 'bigint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('labour_rates', 'is_active')['column_default'])->toBe('true');
});

it('creates tax_rates with the columns of 02 §6.6 and no soft deletes', function (): void {
    expect(PgSchema::columns('tax_rates'))->toBe(PgSchema::sorted([
        'id', 'name', 'rate_bps', 'is_default', 'is_active', 'created_at', 'updated_at',
    ]))
        ->and(PgSchema::column('tax_rates', 'name'))->toMatchArray(['character_maximum_length' => 60, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('tax_rates', 'rate_bps'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('tax_rates', 'is_default'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('tax_rates', 'is_active')['column_default'])->toBe('true');
});

it('makes code unique on materials, edge bands, hardware items and finishes and key unique on labour rates', function (string $table, string $column): void {
    $index = PgSchema::indexDefinition($table, "{$table}_{$column}_unique");

    expect($index)->not->toBeNull()
        ->and($index)->toContain('CREATE UNIQUE INDEX')
        ->and($index)->toContain("({$column})");
})->with([
    ['materials', 'code'],
    ['edge_bands', 'code'],
    ['hardware_items', 'code'],
    ['finishes', 'code'],
    ['labour_rates', 'key'],
]);

it('allows exactly one default tax rate through a partial unique index', function (): void {
    expect(PgSchema::indexDefinition('tax_rates', 'tax_rates_is_default_unique'))
        ->toContain('CREATE UNIQUE INDEX')
        ->toContain('(is_default)')
        ->toContain('WHERE is_default');

    TaxRate::factory()->default()->create();
    TaxRate::factory()->count(2)->create();

    expect(fn () => TaxRate::factory()->default()->create())->toThrow(QueryException::class);
});

it('rejects a duplicate material code', function (): void {
    Material::factory()->create(['code' => 'DUP-1']);

    expect(fn () => Material::factory()->create(['code' => 'DUP-1']))->toThrow(QueryException::class);
});

it('fills the table defaults when only the required columns are inserted', function (): void {
    $id = (string) Str::ulid();

    DB::table('materials')->insert([
        'id' => $id, 'code' => 'RAW-1', 'name' => 'Raw', 'board_type' => 'mdf', 'thickness_mm' => 18,
        'sheet_length_mm' => 2440, 'sheet_width_mm' => 1220, 'created_at' => now(), 'updated_at' => now(),
    ]);

    $row = DB::table('materials')->where('id', $id)->first();

    expect($row->waste_factor)->toBe('0.100')
        ->and($row->surface)->toBe('melamine')
        ->and($row->usage)->toBe('["carcass", "shelf", "front", "back", "top"]')
        ->and($row->has_grain)->toBeFalse()
        ->and($row->is_active)->toBeTrue()
        ->and($row->sort_order)->toBe(0);

    $hardwareId = (string) Str::ulid();

    DB::table('hardware_items')->insert([
        'id' => $hardwareId, 'code' => 'HW-RAW', 'name' => 'Raw', 'category' => 'other', 'specs' => '{}', 'unit' => 'piece',
        'created_at' => now(), 'updated_at' => now(),
    ]);

    expect(DB::table('hardware_items')->where('id', $hardwareId)->value('is_default_for'))->toBe('[]');
});
