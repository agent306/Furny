<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Support\PgSchema;

/**
 * 02 §1.6, §1.7, §1.8 and §15 group 2.
 */
it('uses char(26) ULID morph keys for the spatie permission pivots', function (): void {
    expect(PgSchema::column('model_has_roles', 'model_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('model_has_permissions', 'model_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(config('permission.column_names.model_morph_key'))->toBe('model_id');
});

it('uses a char(26) ULID morph key for media', function (): void {
    expect(PgSchema::column('media', 'model_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('media', 'model_type'))->toMatchArray(['data_type' => 'character varying', 'is_nullable' => 'NO']);
});

it('uses nullable char(26) ULID morph keys for the activity log', function (): void {
    expect(PgSchema::column('activity_log', 'subject_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('activity_log', 'causer_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('activity_log', 'subject_type'))->toMatchArray(['data_type' => 'character varying', 'is_nullable' => 'YES']);
});

it('creates notifications with a uuid id, a ULID notifiable and the two notification-centre indexes', function (): void {
    expect(PgSchema::column('notifications', 'id'))->toMatchArray(['udt_name' => 'uuid'])
        ->and(PgSchema::column('notifications', 'notifiable_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::indexDefinition('notifications', 'notifications_notifiable_id_read_at_index'))->toContain('(notifiable_id, read_at)')
        ->and(PgSchema::indexDefinition('notifications', 'notifications_notifiable_id_created_at_index'))->toContain('(notifiable_id, created_at)');
});

it('creates notification_deliveries with exactly the 02 §1.7 columns', function (): void {
    expect(PgSchema::columns('notification_deliveries'))->toBe(PgSchema::sorted([
        'id', 'notification_id', 'user_id', 'event_key', 'channel', 'driver', 'to_masked', 'to_hash',
        'template_name', 'provider_message_id', 'status', 'error_code', 'error_title', 'pricing_category',
        'billable', 'fallback_of_id', 'context', 'attempts', 'accepted_at', 'sent_at', 'delivered_at',
        'read_at', 'failed_at', 'created_at', 'updated_at',
    ]));

    expect(PgSchema::column('notification_deliveries', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('notification_deliveries', 'notification_id'))->toMatchArray(['udt_name' => 'uuid', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'user_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'event_key'))->toMatchArray(['character_maximum_length' => 64, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'channel'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'driver'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'to_masked'))->toMatchArray(['character_maximum_length' => 32, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'to_hash'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 64, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'template_name'))->toMatchArray(['character_maximum_length' => 128, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'provider_message_id'))->toMatchArray(['character_maximum_length' => 128, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'status'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'error_code'))->toMatchArray(['character_maximum_length' => 32, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'error_title'))->toMatchArray(['character_maximum_length' => 255, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'pricing_category'))->toMatchArray(['character_maximum_length' => 24, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'billable'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'fallback_of_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'context'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'attempts'))->toMatchArray(['udt_name' => 'int2', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('notification_deliveries', 'accepted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'failed_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('notification_deliveries', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz']);

    expect(PgSchema::column('notification_deliveries', 'status')['column_default'])->toContain('pending')
        ->and(PgSchema::column('notification_deliveries', 'attempts')['column_default'])->toContain('0');
});

it('creates the notification_deliveries indexes of 02 §1.7', function (): void {
    expect(PgSchema::indexDefinition('notification_deliveries', 'notification_deliveries_driver_provider_message_id_unique'))
        ->toContain('UNIQUE')->toContain('(driver, provider_message_id)')->toContain('WHERE (provider_message_id IS NOT NULL)')
        ->and(PgSchema::indexDefinition('notification_deliveries', 'notification_deliveries_user_id_channel_created_at_index'))->toContain('(user_id, channel, created_at)')
        ->and(PgSchema::indexDefinition('notification_deliveries', 'notification_deliveries_to_hash_channel_created_at_index'))->toContain('(to_hash, channel, created_at)')
        ->and(PgSchema::indexDefinition('notification_deliveries', 'notification_deliveries_event_key_created_at_index'))->toContain('(event_key, created_at)')
        ->and(PgSchema::indexDefinition('notification_deliveries', 'notification_deliveries_status_created_at_index'))->toContain('(status, created_at)');
});

it('sets null on delete for the notification_deliveries foreign keys', function (): void {
    $rules = collect(DB::select(
        "select a.attname as column_name, c.confdeltype as on_delete, c.confrelid::regclass::text as references_table
         from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
         where c.contype = 'f' and c.conrelid = 'notification_deliveries'::regclass",
    ))->keyBy('column_name');

    expect($rules->keys()->sort()->values()->all())->toBe(['fallback_of_id', 'user_id'])
        ->and($rules['user_id']->on_delete)->toBe('n')
        ->and($rules['user_id']->references_table)->toBe('users')
        ->and($rules['fallback_of_id']->on_delete)->toBe('n')
        ->and($rules['fallback_of_id']->references_table)->toBe('notification_deliveries');
});

it('uses a char(26) ULID morph key for push subscriptions', function (): void {
    expect(PgSchema::column('push_subscriptions', 'subscribable_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('push_subscriptions', 'subscribable_type'))->toMatchArray(['data_type' => 'character varying']);
});

it('creates upload_intents with exactly the 02 §1.6 columns', function (): void {
    expect(PgSchema::columns('upload_intents'))->toBe(PgSchema::sorted([
        'id', 'user_id', 'purpose', 'target_type', 'target_id', 'object_key', 'processed_key',
        'original_filename', 'declared_mime', 'declared_size', 'sniffed_mime', 'width', 'height',
        'status', 'reason_code', 'expires_at', 'consumed_at', 'created_at', 'updated_at',
    ]));

    expect(PgSchema::column('upload_intents', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('upload_intents', 'user_id'))->toMatchArray(['character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'purpose'))->toMatchArray(['character_maximum_length' => 32, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'target_type'))->toMatchArray(['character_maximum_length' => 64, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'target_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'object_key'))->toMatchArray(['character_maximum_length' => 255, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'processed_key'))->toMatchArray(['character_maximum_length' => 255, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'original_filename'))->toMatchArray(['character_maximum_length' => 255, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'declared_mime'))->toMatchArray(['character_maximum_length' => 100, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'declared_size'))->toMatchArray(['udt_name' => 'int8', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'sniffed_mime'))->toMatchArray(['character_maximum_length' => 100, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'width'))->toMatchArray(['udt_name' => 'int4', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'height'))->toMatchArray(['udt_name' => 'int4', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'status'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'reason_code'))->toMatchArray(['character_maximum_length' => 48, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('upload_intents', 'expires_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('upload_intents', 'consumed_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES']);
});

it('defaults upload_intents.status to pending and indexes it as 02 §1.6 lists', function (): void {
    expect(PgSchema::column('upload_intents', 'status')['column_default'])->toContain("'pending'")
        ->and(PgSchema::indexDefinition('upload_intents', 'upload_intents_user_id_created_at_index'))->toContain('(user_id, created_at)')
        ->and(PgSchema::indexDefinition('upload_intents', 'upload_intents_status_created_at_index'))->toContain('(status, created_at)');
});

it('cascades upload_intents when the uploader is deleted', function (): void {
    $rule = DB::selectOne(
        "select c.confdeltype as on_delete from pg_constraint c
         where c.contype = 'f' and c.conrelid = 'upload_intents'::regclass and c.confrelid = 'users'::regclass",
    );

    expect($rule->on_delete)->toBe('c');
});

it('stores sessions against a char(26) ULID user id', function (): void {
    expect(PgSchema::column('sessions', 'user_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES'])
        ->and(PgSchema::columns('sessions'))->toBe(PgSchema::sorted(['id', 'user_id', 'ip_address', 'user_agent', 'payload', 'last_activity']));
});

it('creates the framework, Pulse and Telescope tables', function (string $table): void {
    expect(Schema::hasTable($table))->toBeTrue();
})->with([
    'jobs', 'job_batches', 'failed_jobs', 'cache', 'cache_locks',
    'pulse_values', 'pulse_entries', 'pulse_aggregates',
    'telescope_entries', 'telescope_entries_tags', 'telescope_monitoring',
    'permissions', 'roles', 'role_has_permissions', 'password_reset_tokens',
]);
