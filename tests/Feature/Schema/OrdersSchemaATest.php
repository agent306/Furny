<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\PgSchema;

/**
 * 02 §8.1–§8.4 and §15 group 8 (orders, items and change proposals; quotes and the other order tables arrive in Task 11).
 */
it('creates orders with the columns of 02 §8.1', function (): void {
    expect(PgSchema::columns('orders'))->toBe(PgSchema::sorted([
        'id', 'number', 'project_id', 'customer_id', 'state', 'state_before_hold', 'assigned_to',
        'production_assignee_id', 'title', 'customer_notes', 'site_address_id', 'needs_installation',
        'preferred_delivery_on', 'expected_delivery_on', 'accepted_quote_id', 'current_quote_id',
        'production_progress', 'production_stage', 'cancel_reason', 'cancel_note',
        'submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at',
        'completed_at', 'customer_approved_at', 'delivered_at', 'closed_at', 'cancelled_at',
        'last_customer_activity_at', 'last_staff_activity_at', 'state_changed_at',
        'created_at', 'updated_at', 'deleted_at',
    ]))
        ->and(PgSchema::column('orders', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'number'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 20, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'project_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'customer_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'state'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 32, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'state_before_hold'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 32, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'assigned_to'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'production_assignee_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'title'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 160, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'customer_notes'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'site_address_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'needs_installation'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'preferred_delivery_on'))->toMatchArray(['data_type' => 'date', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'expected_delivery_on'))->toMatchArray(['data_type' => 'date', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'accepted_quote_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'current_quote_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'production_progress'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'production_stage'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 32, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'cancel_reason'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 32, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'cancel_note'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('orders', 'state_changed_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('orders', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz'])
        ->and(PgSchema::column('orders', 'updated_at'))->toMatchArray(['udt_name' => 'timestamptz'])
        ->and(PgSchema::column('orders', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('declares every milestone and activity timestamp of orders as a nullable timestamptz', function (string $column): void {
    expect(PgSchema::column('orders', $column))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
})->with([
    'submitted_at', 'reviewed_at', 'quoted_at', 'accepted_at', 'confirmed_at', 'production_started_at',
    'completed_at', 'customer_approved_at', 'delivered_at', 'closed_at', 'cancelled_at',
    'last_customer_activity_at', 'last_staff_activity_at',
]);

it('defaults orders as in 02 §8.1', function (): void {
    expect(PgSchema::column('orders', 'state')['column_default'])->toContain("'draft'")
        ->and(PgSchema::column('orders', 'needs_installation')['column_default'])->toBe('true')
        ->and(PgSchema::column('orders', 'production_progress')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::column('orders', 'state_changed_at')['column_default'])->toBe('now()');
});

it('indexes orders as listed in 02 §8.1', function (): void {
    expect(PgSchema::indexDefinition('orders', 'orders_number_unique'))->toContain('UNIQUE')->toContain('(number)')
        ->and(PgSchema::indexDefinition('orders', 'orders_state_updated_at_index'))->toContain('(state, updated_at)')
        ->and(PgSchema::indexDefinition('orders', 'orders_state_state_changed_at_index'))->toContain('(state, state_changed_at)')
        ->and(PgSchema::indexDefinition('orders', 'orders_customer_id_created_at_index'))->toContain('(customer_id, created_at)')
        ->and(PgSchema::indexDefinition('orders', 'orders_assigned_to_state_index'))->toContain('(assigned_to, state)');
});

it('creates order_items with the columns of 02 §8.2', function (): void {
    expect(PgSchema::columns('order_items'))->toBe(PgSchema::sorted([
        'id', 'order_id', 'furniture_design_id', 'furniture_revision_id', 'quantity', 'room_label',
        'customer_notes', 'staff_notes', 'sort_order', 'created_at', 'updated_at',
    ]))
        ->and(PgSchema::column('order_items', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('order_items', 'order_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('order_items', 'furniture_design_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('order_items', 'furniture_revision_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('order_items', 'quantity'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('order_items', 'room_label'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 80, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('order_items', 'customer_notes'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('order_items', 'staff_notes'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('order_items', 'sort_order'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('order_items', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz'])
        ->and(PgSchema::column('order_items', 'updated_at'))->toMatchArray(['udt_name' => 'timestamptz']);
});

it('defaults order_items as in 02 §8.2 and makes (order_id, furniture_design_id) unique', function (): void {
    expect(PgSchema::column('order_items', 'quantity')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('order_items', 'sort_order')['column_default'])->toMatch("/^'?0'?/")
        ->and(PgSchema::indexDefinition('order_items', 'order_items_order_id_furniture_design_id_unique'))
        ->toContain('UNIQUE')->toContain('(order_id, furniture_design_id)');
});

it('creates change_proposals with the columns of 02 §8.3', function (): void {
    expect(PgSchema::columns('change_proposals'))->toBe(PgSchema::sorted([
        'id', 'order_id', 'number', 'status', 'message', 'created_by', 'sent_at', 'resolved_at', 'withdrawn_at',
        'customer_comment', 'created_at', 'updated_at',
    ]))
        ->and(PgSchema::column('change_proposals', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('change_proposals', 'order_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposals', 'number'))->toMatchArray(['data_type' => 'smallint', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposals', 'status'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposals', 'message'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposals', 'created_by'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposals', 'sent_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposals', 'resolved_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposals', 'withdrawn_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposals', 'customer_comment'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES']);
});

it('defaults change_proposals.status to draft and makes (order_id, number) unique', function (): void {
    expect(PgSchema::column('change_proposals', 'status')['column_default'])->toContain("'draft'")
        ->and(PgSchema::indexDefinition('change_proposals', 'change_proposals_order_id_number_unique'))
        ->toContain('UNIQUE')->toContain('(order_id, number)');
});

it('creates change_proposal_items with the columns of 02 §8.4', function (): void {
    expect(PgSchema::columns('change_proposal_items'))->toBe(PgSchema::sorted([
        'id', 'change_proposal_id', 'order_item_id', 'from_revision_id', 'to_revision_id', 'staff_draft_document',
        'staff_draft_version', 'changes', 'staff_note', 'decision', 'customer_comment', 'decided_at',
        'created_at', 'updated_at',
    ]))
        ->and(PgSchema::column('change_proposal_items', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('change_proposal_items', 'change_proposal_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposal_items', 'order_item_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposal_items', 'from_revision_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposal_items', 'to_revision_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposal_items', 'staff_draft_document'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposal_items', 'staff_draft_version'))->toMatchArray(['data_type' => 'integer', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposal_items', 'changes'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposal_items', 'staff_note'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposal_items', 'decision'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('change_proposal_items', 'customer_comment'))->toMatchArray(['data_type' => 'text', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('change_proposal_items', 'decided_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('defaults change_proposal_items as in 02 §8.4 and makes (change_proposal_id, order_item_id) unique', function (): void {
    expect(PgSchema::column('change_proposal_items', 'staff_draft_version')['column_default'])->toMatch("/^'?1'?/")
        ->and(PgSchema::column('change_proposal_items', 'decision')['column_default'])->toContain("'pending'")
        ->and(PgSchema::indexDefinition('change_proposal_items', 'change_proposal_items_change_proposal_id_order_item_id_unique'))
        ->toContain('UNIQUE')->toContain('(change_proposal_id, order_item_id)');
});

it('leaves accepted_quote_id and current_quote_id without foreign keys until the quotes table exists', function (): void {
    $constrained = DB::select(
        "select a.attname as col
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.conrelid = 'orders'::regclass and a.attname in ('accepted_quote_id', 'current_quote_id')",
    );

    expect($constrained)->toBe([]);
});

it('declares the foreign key actions of 02 §8.1–§8.4', function (): void {
    $tables = "'orders', 'order_items', 'change_proposals', 'change_proposal_items'";
    $actions = collect(DB::select(
        "select conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action, c.confrelid::regclass::text as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.conrelid::regclass::text in ({$tables})",
    ))->mapWithKeys(static fn (object $row): array => ["{$row->tbl}.{$row->col}" => "{$row->action}:{$row->ref}"]);

    // r = restrict (R), c = cascade (C), n = set null (N); the two quote ids get their FKs with Task 11.
    expect($actions->all())->toEqual([
        'orders.project_id' => 'r:projects',
        'orders.customer_id' => 'r:users',
        'orders.assigned_to' => 'n:users',
        'orders.production_assignee_id' => 'n:users',
        'orders.site_address_id' => 'n:addresses',
        'order_items.order_id' => 'c:orders',
        'order_items.furniture_design_id' => 'r:furniture_designs',
        'order_items.furniture_revision_id' => 'r:furniture_revisions',
        'change_proposals.order_id' => 'c:orders',
        'change_proposals.created_by' => 'r:users',
        'change_proposal_items.change_proposal_id' => 'c:change_proposals',
        'change_proposal_items.order_item_id' => 'c:order_items',
        'change_proposal_items.from_revision_id' => 'r:furniture_revisions',
        'change_proposal_items.to_revision_id' => 'r:furniture_revisions',
    ]);
});
