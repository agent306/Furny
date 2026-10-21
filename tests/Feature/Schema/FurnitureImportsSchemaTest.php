<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\PgSchema;

/**
 * 02 §4.1, §5.1–§5.4 and §15 groups 6–7.
 */
it('creates furniture_designs with the columns of 02 §5.1', function (): void {
    expect(PgSchema::columns('furniture_designs'))->toBe(PgSchema::sorted([
        'id', 'project_id', 'owner_id', 'created_by', 'name', 'template_key', 'preset_id', 'working_document',
        'working_version', 'working_saved_by', 'working_saved_at', 'current_revision_id', 'locked_by_order_id',
        'estimate', 'width_mm', 'height_mm', 'depth_mm', 'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('furniture_designs', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('furniture_designs', 'project_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'owner_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'created_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_designs', 'name'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'template_key'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'preset_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_designs', 'working_document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'working_version'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'working_saved_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_designs', 'working_saved_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_designs', 'current_revision_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_designs', 'locked_by_order_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_designs', 'estimate'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'width_mm'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'height_mm'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'depth_mm'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_designs', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('defaults furniture_designs as in 02 §5.1', function (): void {
    expect(PgSchema::column('furniture_designs', 'working_version')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('furniture_designs', 'estimate')['column_default'])->toContain("'{}'");
});

it('indexes furniture_designs by project/updated_at and locking order', function (): void {
    expect(PgSchema::indexDefinition('furniture_designs', 'furniture_designs_project_id_updated_at_index'))->toContain('(project_id, updated_at)')
        ->and(PgSchema::indexDefinition('furniture_designs', 'furniture_designs_locked_by_order_id_index'))->toContain('(locked_by_order_id)');
});

it('creates furniture_revisions with created_at only (02 §5.2)', function (): void {
    expect(PgSchema::columns('furniture_revisions'))->toBe(PgSchema::sorted([
        'id', 'furniture_design_id', 'number', 'document', 'schema_version', 'bom', 'price', 'bom_status',
        'engine_version', 'catalog_version', 'reason', 'author_id', 'author_kind', 'change_summary', 'created_at',
    ]))
        ->and(PgSchema::column('furniture_revisions', 'furniture_design_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'number'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'schema_version'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'bom'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_revisions', 'price'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_revisions', 'bom_status'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'engine_version'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_revisions', 'catalog_version'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_revisions', 'reason'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'author_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_revisions', 'author_kind'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 8, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_revisions', 'change_summary'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_revisions', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'NO']);
});

it('defaults furniture_revisions.bom_status to pending', function (): void {
    expect(PgSchema::column('furniture_revisions', 'bom_status')['column_default'])->toContain("'pending'");
});

it('makes (furniture_design_id, number) unique on furniture_revisions', function (): void {
    expect(PgSchema::indexDefinition('furniture_revisions', 'furniture_revisions_furniture_design_id_number_unique'))
        ->toContain('UNIQUE')->toContain('(furniture_design_id, number)');
});

it('creates furniture_presets with the columns of 02 §5.3', function (): void {
    expect(PgSchema::columns('furniture_presets'))->toBe(PgSchema::sorted([
        'id', 'name', 'slug', 'template_key', 'category', 'description', 'document', 'is_active', 'sort_order',
        'created_by', 'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('furniture_presets', 'name'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'slug'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 140, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'template_key'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'category'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 32, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'description'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('furniture_presets', 'document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'is_active'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'sort_order'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_presets', 'created_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES']);
});

it('defaults furniture_presets as in 02 §5.3 and makes slug unique', function (): void {
    expect(PgSchema::column('furniture_presets', 'is_active')['column_default'])->toBe('true')
        ->and(PgSchema::column('furniture_presets', 'sort_order')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::indexDefinition('furniture_presets', 'furniture_presets_slug_unique'))->toContain('UNIQUE')->toContain('(slug)');
});

it('creates furniture_template_settings keyed by template_key (02 §5.4)', function (): void {
    $primary = DB::selectOne(
        "select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
         where i.indrelid = 'furniture_template_settings'::regclass and i.indisprimary",
    );

    expect(PgSchema::columns('furniture_template_settings'))->toBe(PgSchema::sorted([
        'template_key', 'is_enabled', 'sort_order', 'default_overrides', 'created_at', 'updated_at',
    ]))
        ->and($primary->col)->toBe('template_key')
        ->and(PgSchema::column('furniture_template_settings', 'template_key'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 40, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_template_settings', 'is_enabled')['column_default'])->toBe('true')
        ->and(PgSchema::column('furniture_template_settings', 'sort_order')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::column('furniture_template_settings', 'default_overrides'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('furniture_template_settings', 'default_overrides')['column_default'])->toContain("'{}'");
});

it('creates blueprint_imports with the columns of 02 §4.1', function (): void {
    expect(PgSchema::columns('blueprint_imports'))->toBe(PgSchema::sorted([
        'id', 'project_id', 'plan_id', 'user_id', 'status', 'mode', 'source_kind', 'original_filename', 'mime_type',
        'file_size_bytes', 'page_count', 'selected_page', 'hints', 'ai_provider', 'ai_model', 'credits_reserved',
        'credits_charged', 'result_document', 'result_meta', 'review_version', 'error_code', 'error_message',
        'attempts', 'started_at', 'finished_at', 'created_at', 'updated_at',
    ]))
        ->and(PgSchema::column('blueprint_imports', 'project_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'plan_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'user_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'status'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'mode'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'source_kind'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'original_filename'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 255, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'mime_type'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 100, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'file_size_bytes'))->toMatchArray(['data_type' => 'bigint', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'page_count'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'selected_page'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'hints'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'ai_provider'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 24, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'ai_model'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 100, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'credits_reserved'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'credits_charged'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'result_document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'result_meta'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'review_version'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'error_code'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 48, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'error_message'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'attempts'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('blueprint_imports', 'started_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('blueprint_imports', 'finished_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('defaults blueprint_imports as in 02 §4.1', function (): void {
    expect(PgSchema::column('blueprint_imports', 'status')['column_default'])->toContain("'uploaded'")
        ->and(PgSchema::column('blueprint_imports', 'mode')['column_default'])->toContain("'auto'")
        ->and(PgSchema::column('blueprint_imports', 'selected_page')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('blueprint_imports', 'hints')['column_default'])->toContain("'{}'")
        ->and(PgSchema::column('blueprint_imports', 'review_version')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('blueprint_imports', 'credits_reserved')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::column('blueprint_imports', 'credits_charged')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::column('blueprint_imports', 'attempts')['column_default'])->toMatch("/^'?0'?/");
});

it('indexes blueprint_imports by user/created_at and status', function (): void {
    expect(PgSchema::indexDefinition('blueprint_imports', 'blueprint_imports_user_id_created_at_index'))->toContain('(user_id, created_at)')
        ->and(PgSchema::indexDefinition('blueprint_imports', 'blueprint_imports_status_index'))->toContain('(status)');
});

it('declares the foreign key actions of 02 §4–§5', function (): void {
    $tables = "'furniture_presets', 'furniture_designs', 'furniture_revisions', 'blueprint_imports'";
    $actions = collect(DB::select(
        "select conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.conrelid::regclass::text in ({$tables})",
    ))->mapWithKeys(static fn (object $row): array => ["{$row->tbl}.{$row->col}" => $row->action]);

    // r = restrict (R), c = cascade (C), n = set null (N); locked_by_order_id has no FK until Task 11.
    expect($actions->all())->toEqual([
        'furniture_presets.created_by' => 'n',
        'furniture_designs.project_id' => 'c',
        'furniture_designs.owner_id' => 'r',
        'furniture_designs.created_by' => 'n',
        'furniture_designs.preset_id' => 'n',
        'furniture_designs.working_saved_by' => 'n',
        'furniture_designs.current_revision_id' => 'n',
        'furniture_revisions.furniture_design_id' => 'c',
        'furniture_revisions.author_id' => 'n',
        'blueprint_imports.project_id' => 'c',
        'blueprint_imports.plan_id' => 'n',
        'blueprint_imports.user_id' => 'r',
    ]);
});
