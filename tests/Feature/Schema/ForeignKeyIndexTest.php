<?php

declare(strict_types=1);

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Support\PgSchema;

/**
 * Postgres does not index foreign keys (master §6.3, 02 §0). Every foreign key of the schema, ours and
 * the packages', must have its columns as the leading prefix of an index (a primary key or unique index
 * counts), so a parent delete and a join from the child never scan the child table.
 *
 * Exceptions, each with a reason. There are none: write the index in the create migration instead.
 */
const FOREIGN_KEYS_WITHOUT_INDEX = [];

it('indexes every foreign key of the schema', function (): void {
    expect(array_values(array_diff(PgSchema::unindexedForeignKeys(), FOREIGN_KEYS_WITHOUT_INDEX)))->toBe([]);
});

it('has the plain foreign key indexes of the sweep, named by Laravel default', function (): void {
    // Every foreign key that 02 left without an index (controller rulings, logged in 19), table => columns.
    $added = [
        'addresses' => ['user_id'],
        'staff_invitations' => ['invited_by', 'user_id'],
        'role_has_permissions' => ['role_id'],
        'notification_deliveries' => ['fallback_of_id'],
        'app_settings' => ['updated_by'],
        'projects' => ['created_by', 'site_address_id'],
        'plans' => ['current_revision_id', 'locked_by', 'working_saved_by'],
        'plan_revisions' => ['author_id'],
        'furniture_presets' => ['created_by'],
        'furniture_designs' => ['created_by', 'current_revision_id', 'owner_id', 'preset_id', 'working_saved_by'],
        'furniture_revisions' => ['author_id'],
        'blueprint_imports' => ['plan_id', 'project_id'],
        'orders' => ['accepted_quote_id', 'current_quote_id', 'production_assignee_id', 'project_id', 'site_address_id'],
        'order_items' => ['furniture_design_id', 'furniture_revision_id'],
        'change_proposals' => ['created_by'],
        'change_proposal_items' => ['from_revision_id', 'order_item_id', 'to_revision_id'],
        'quotes' => ['created_by'],
        'quote_lines' => ['order_item_id', 'quote_id', 'tax_rate_id'],
        'quote_negotiations' => ['answered_by', 'customer_id', 'order_id', 'quote_id', 'resulting_quote_id'],
        'confirmation_calls' => ['order_id', 'staff_id'],
        'production_updates' => ['author_id'],
        'order_issues' => ['order_id', 'order_item_id', 'raised_by', 'resolved_by'],
        'deliveries' => ['recorded_by'],
        'payments' => ['order_id', 'quote_id', 'recorded_by'],
        'messages' => ['author_id'],
        'message_reads' => ['user_id'],
        'ai_credit_ledger' => ['created_by'],
    ];
    $count = 0;

    foreach ($added as $table => $columns) {
        foreach ($columns as $column) {
            $definition = PgSchema::indexDefinition($table, "{$table}_{$column}_index");

            expect($definition)->not->toBeNull("{$table}.{$column} has no plain index")
                ->and($definition)->not->toContain('UNIQUE')->toContain("({$column})");
            $count++;
        }
    }

    expect($count)->toBe(55);
});

it('keeps no stale entry in the allowlist', function (): void {
    expect(array_values(array_diff(FOREIGN_KEYS_WITHOUT_INDEX, PgSchema::unindexedForeignKeys())))->toBe([]);
});

it('detects a foreign key without a leading index, and accepts primary, unique and composite coverage', function (): void {
    Schema::create('fk_probe_parent', function (Blueprint $table): void {
        $table->id();
    });
    Schema::create('fk_probe_child', function (Blueprint $table): void {
        $table->id();
        $table->foreignId('bare_id')->constrained('fk_probe_parent');
        $table->foreignId('trailing_id')->constrained('fk_probe_parent');
        $table->foreignId('leading_id')->constrained('fk_probe_parent');
        $table->foreignId('unique_id')->unique()->constrained('fk_probe_parent');
        $table->foreignId('partial_id')->constrained('fk_probe_parent');
        $table->string('kind');
        $table->index(['kind', 'trailing_id']);
        $table->index(['leading_id', 'kind']);
    });
    Schema::create('fk_probe_pivot', function (Blueprint $table): void {
        $table->foreignId('a_id')->constrained('fk_probe_parent');
        $table->foreignId('b_id')->constrained('fk_probe_parent');
        $table->primary(['a_id', 'b_id']);
    });
    DB::statement('create index fk_probe_child_partial on fk_probe_child (partial_id) where kind = \'x\'');

    $probes = array_values(array_filter(PgSchema::unindexedForeignKeys(), static fn (string $name): bool => str_starts_with($name, 'fk_probe_')));

    // a_id leads the pivot's primary key; b_id is its second column and is not covered.
    expect($probes)->toBe([
        'fk_probe_child(bare_id)',
        'fk_probe_child(partial_id)',
        'fk_probe_child(trailing_id)',
        'fk_probe_pivot(b_id)',
    ]);
});
