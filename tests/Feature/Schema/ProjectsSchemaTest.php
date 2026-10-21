<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\PgSchema;

/**
 * 02 §3.1–§3.3 and §15 group 4.
 */
it('creates projects with the columns of 02 §3.1', function (): void {
    expect(PgSchema::columns('projects'))->toBe(PgSchema::sorted([
        'id', 'owner_id', 'created_by', 'name', 'property_type', 'site_address_id', 'notes', 'status',
        'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('projects', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('projects', 'owner_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('projects', 'created_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('projects', 'name'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('projects', 'property_type'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('projects', 'site_address_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('projects', 'notes'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('projects', 'status'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('projects', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('projects', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz']);
});

it('defaults projects to an active apartment', function (): void {
    expect(PgSchema::column('projects', 'property_type')['column_default'])->toContain("'apartment'")
        ->and(PgSchema::column('projects', 'status')['column_default'])->toContain("'active'");
});

it('indexes projects by owner, status and updated_at', function (): void {
    expect(PgSchema::indexDefinition('projects', 'projects_owner_id_status_updated_at_index'))
        ->toContain('(owner_id, status, updated_at)');
});

it('creates plans with the columns of 02 §3.2', function (): void {
    expect(PgSchema::columns('plans'))->toBe(PgSchema::sorted([
        'id', 'project_id', 'name', 'level_index', 'source', 'working_document', 'working_version', 'working_saved_by',
        'working_saved_at', 'current_revision_id', 'schema_version', 'summary', 'locked_at', 'locked_by',
        'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('plans', 'project_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'name'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 80, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'level_index'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'source'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'working_document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'working_version'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'working_saved_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('plans', 'working_saved_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('plans', 'current_revision_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('plans', 'schema_version'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'summary'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plans', 'locked_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('plans', 'locked_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES']);
});

it('defaults plans as in 02 §3.2', function (): void {
    expect(PgSchema::column('plans', 'name')['column_default'])->toContain("'Ground floor'")
        ->and(PgSchema::column('plans', 'level_index')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::column('plans', 'working_version')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('plans', 'schema_version')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('plans', 'summary')['column_default'])->toContain("'{}'");
});

it('indexes plans by project and level_index', function (): void {
    expect(PgSchema::indexDefinition('plans', 'plans_project_id_level_index_index'))->toContain('(project_id, level_index)');
});

it('creates plan_revisions without updated_at or soft deletes', function (): void {
    expect(PgSchema::columns('plan_revisions'))->toBe(PgSchema::sorted([
        'id', 'plan_id', 'number', 'document', 'schema_version', 'reason', 'label', 'author_id', 'created_at',
    ]))
        ->and(PgSchema::column('plan_revisions', 'plan_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plan_revisions', 'number'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plan_revisions', 'document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plan_revisions', 'schema_version'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plan_revisions', 'reason'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 24, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('plan_revisions', 'label'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 120, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('plan_revisions', 'author_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('plan_revisions', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'NO']);
});

it('makes (plan_id, number) unique on plan_revisions', function (): void {
    expect(PgSchema::indexDefinition('plan_revisions', 'plan_revisions_plan_id_number_unique'))
        ->toContain('UNIQUE')->toContain('(plan_id, number)');
});

it('declares the foreign key actions of 02 §3', function (): void {
    $actions = collect(DB::select(
        "select conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.conrelid::regclass::text in ('projects', 'plans', 'plan_revisions')",
    ))->mapWithKeys(static fn (object $row): array => ["{$row->tbl}.{$row->col}" => $row->action]);

    // r = restrict (R), c = cascade (C), n = set null (N)
    expect($actions->all())->toEqual([
        'projects.owner_id' => 'r',
        'projects.created_by' => 'n',
        'projects.site_address_id' => 'n',
        'plans.project_id' => 'c',
        'plans.working_saved_by' => 'n',
        'plans.locked_by' => 'n',
        'plans.current_revision_id' => 'n',
        'plan_revisions.plan_id' => 'c',
        'plan_revisions.author_id' => 'n',
    ]);
});
