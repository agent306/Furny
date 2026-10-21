<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\PgSchema;

it('creates users with exactly the 02 §1.1 columns', function (): void {
    expect(PgSchema::columns('users'))->toBe(PgSchema::sorted([
        'id', 'type', 'name', 'email', 'email_verified_at', 'phone_e164', 'phone_verified_at', 'password',
        'google_id', 'unit_system', 'length_unit', 'locale', 'timezone', 'is_active', 'last_login_at',
        'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at', 'remember_token',
        'marketing_opt_in', 'notes_internal', 'terms_accepted_at', 'onboarded_at', 'anonymised_at',
        'created_at', 'updated_at', 'deleted_at',
    ]));

    expect(PgSchema::column('users', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('users', 'email'))->toMatchArray(['character_maximum_length' => 254, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('users', 'phone_e164'))->toMatchArray(['character_maximum_length' => 20, 'is_nullable' => 'YES'])
        ->and(PgSchema::column('users', 'type'))->toMatchArray(['character_maximum_length' => 16, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('users', 'name'))->toMatchArray(['character_maximum_length' => 120, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('users', 'password'))->toMatchArray(['is_nullable' => 'YES'])
        ->and(PgSchema::column('users', 'google_id'))->toMatchArray(['character_maximum_length' => 64])
        ->and(PgSchema::column('users', 'created_at'))->toMatchArray(['udt_name' => 'timestamptz'])
        ->and(PgSchema::column('users', 'deleted_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('users', 'email_verified_at'))->toMatchArray(['udt_name' => 'timestamptz']);
});

it('creates the users indexes of 02 §1.1', function (): void {
    expect(PgSchema::indexDefinition('users', 'users_email_unique'))
        ->toContain('UNIQUE')->toContain('(email)')->toContain('WHERE (email IS NOT NULL)')
        ->and(PgSchema::indexDefinition('users', 'users_phone_e164_unique'))
        ->toContain('UNIQUE')->toContain('(phone_e164)')->toContain('WHERE (phone_e164 IS NOT NULL)')
        ->and(PgSchema::indexDefinition('users', 'users_google_id_unique'))
        ->toContain('UNIQUE')->toContain('(google_id)')->toContain('WHERE (google_id IS NOT NULL)')
        ->and(PgSchema::indexDefinition('users', 'users_type_created_at_index'))
        ->toContain('(type, created_at)');
});

it('rejects a user with neither email nor phone (CHECK)', function (): void {
    DB::table('users')->insert([
        'id' => (string) Str::ulid(), 'type' => 'customer', 'name' => 'No contact',
        'email' => null, 'phone_e164' => null, 'created_at' => now(), 'updated_at' => now(),
    ]);
})->throws(QueryException::class);

it('lets a phone-only user exist', function (): void {
    DB::table('users')->insert([
        'id' => (string) Str::ulid(), 'type' => 'customer', 'name' => 'Phone only',
        'email' => null, 'phone_e164' => '+919800000001', 'created_at' => now(), 'updated_at' => now(),
    ]);

    expect(DB::table('users')->count())->toBe(1);
});

it('keeps a soft-deleted user email reserved (Review Focus 1)', function (): void {
    $first = User::factory()->create(['email' => 'taken@example.com']);
    $first->delete();

    expect(User::query()->find($first->id))->toBeNull()
        ->and(fn () => User::factory()->create(['email' => 'taken@example.com']))
        ->toThrow(QueryException::class);
});

it('creates addresses with exactly the 02 §1.2 columns', function (): void {
    expect(PgSchema::columns('addresses'))->toBe(PgSchema::sorted([
        'id', 'user_id', 'label', 'line1', 'line2', 'city', 'region', 'postal_code', 'country_code',
        'latitude', 'longitude', 'created_at', 'updated_at',
    ]));

    expect(PgSchema::column('addresses', 'id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26])
        ->and(PgSchema::column('addresses', 'user_id'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 26, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('addresses', 'country_code'))->toMatchArray(['data_type' => 'character', 'character_maximum_length' => 2, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('addresses', 'line1'))->toMatchArray(['character_maximum_length' => 200, 'is_nullable' => 'NO'])
        ->and(PgSchema::column('addresses', 'latitude'))->toMatchArray(['data_type' => 'numeric', 'is_nullable' => 'YES']);
});

it('creates password_reset_tokens as the framework table', function (): void {
    expect(PgSchema::columns('password_reset_tokens'))->toBe(PgSchema::sorted(['email', 'token', 'created_at']));
});

it('creates otp_codes with exactly the 02 §1.3 columns', function (): void {
    expect(PgSchema::columns('otp_codes'))->toBe(PgSchema::sorted([
        'id', 'phone_e164', 'purpose', 'channel', 'code_hash', 'attempts', 'expires_at', 'consumed_at', 'ip',
        'created_at', 'updated_at',
    ]));

    expect(PgSchema::column('otp_codes', 'ip'))->toMatchArray(['udt_name' => 'inet', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('otp_codes', 'attempts'))->toMatchArray(['udt_name' => 'int2', 'is_nullable' => 'NO'])
        ->and((string) PgSchema::column('otp_codes', 'attempts')['column_default'])->toContain('0')
        ->and(PgSchema::column('otp_codes', 'expires_at'))->toMatchArray(['udt_name' => 'timestamptz', 'is_nullable' => 'NO'])
        ->and(PgSchema::column('otp_codes', 'code_hash'))->toMatchArray(['character_maximum_length' => 255])
        ->and(PgSchema::indexDefinition('otp_codes', 'otp_codes_phone_e164_index'))->toContain('(phone_e164)');
});

it('creates notification_preferences with exactly the 02 §1.4 columns', function (): void {
    expect(PgSchema::columns('notification_preferences'))->toBe(PgSchema::sorted([
        'id', 'user_id', 'event_key', 'channel', 'enabled', 'created_at', 'updated_at',
    ]));

    expect(PgSchema::indexDefinition('notification_preferences', 'notification_preferences_user_id_event_key_channel_unique'))
        ->toContain('UNIQUE')->toContain('(user_id, event_key, channel)')
        ->and(PgSchema::column('notification_preferences', 'enabled'))->toMatchArray(['data_type' => 'boolean', 'is_nullable' => 'NO']);
});

it('creates staff_invitations with exactly the 02 §1.5 columns', function (): void {
    expect(PgSchema::columns('staff_invitations'))->toBe(PgSchema::sorted([
        'id', 'email', 'name', 'role', 'invited_by', 'expires_at', 'accepted_at', 'revoked_at', 'user_id',
        'created_at', 'updated_at',
    ]));

    expect(PgSchema::indexDefinition('staff_invitations', 'staff_invitations_email_unique'))
        ->toContain('UNIQUE')->toContain('(email)')->toContain('accepted_at IS NULL')->toContain('revoked_at IS NULL')
        ->and(PgSchema::indexDefinition('staff_invitations', 'staff_invitations_created_at_index'))->toContain('(created_at)')
        ->and(PgSchema::column('staff_invitations', 'invited_by'))->toMatchArray(['data_type' => 'character', 'is_nullable' => 'YES'])
        ->and(PgSchema::column('staff_invitations', 'user_id'))->toMatchArray(['data_type' => 'character', 'is_nullable' => 'YES']);
});

it('allows one pending invitation per email but re-invitation after revocation', function (): void {
    $row = fn (array $overrides = []): array => [
        'id' => (string) Str::ulid(), 'email' => 'new.staff@example.com', 'name' => 'New Staff', 'role' => 'estimator',
        'expires_at' => now()->addHours(72), 'created_at' => now(), 'updated_at' => now(), ...$overrides,
    ];

    DB::table('staff_invitations')->insert($row());

    // A savepoint keeps the surrounding test transaction usable after the constraint violation.
    expect(fn () => DB::transaction(fn () => DB::table('staff_invitations')->insert($row())))->toThrow(QueryException::class);

    DB::table('staff_invitations')->update(['revoked_at' => now()]);
    DB::table('staff_invitations')->insert($row());

    expect(DB::table('staff_invitations')->count())->toBe(2);
});
