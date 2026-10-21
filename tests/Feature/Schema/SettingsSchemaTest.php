<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Settings\Models\AppSetting;
use Illuminate\Support\Facades\DB;
use Tests\Support\PgSchema;

/**
 * 02 §2.1, §2.2 and §15 group 3.
 */
it('creates app_settings with a string key, jsonb value and nullable updated_by', function (): void {
    expect(PgSchema::columns('app_settings'))->toBe(PgSchema::sorted(['key', 'value', 'updated_by', 'created_at', 'updated_at']))
        ->and(PgSchema::column('app_settings', 'key'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 100])
        ->and(PgSchema::column('app_settings', 'value'))->toMatchArray(['udt_name' => 'jsonb', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('app_settings', 'updated_by'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'YES']);
});

it('creates number_sequences keyed by a 40-character string', function (): void {
    expect(PgSchema::columns('number_sequences'))->toBe(PgSchema::sorted(['key', 'last_value', 'created_at', 'updated_at']))
        ->and(PgSchema::column('number_sequences', 'key'))->toMatchArray(['data_type' => 'character varying', 'character_maximum_length' => 40])
        ->and(PgSchema::column('number_sequences', 'last_value'))->toMatchArray(['data_type' => 'bigint']);
});

it('nulls updated_by when the user is deleted', function (): void {
    $user = User::factory()->create();
    AppSetting::query()->create(['key' => 'units', 'value' => [], 'updated_by' => $user->id]);

    DB::table('users')->where('id', $user->id)->delete();

    expect(AppSetting::query()->find('units')->updated_by)->toBeNull();
});
