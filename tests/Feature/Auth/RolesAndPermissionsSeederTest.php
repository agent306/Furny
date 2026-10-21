<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Cache\Events\KeyForgetFailed;
use Illuminate\Cache\Events\KeyForgotten;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;
use Tests\Support\PermissionMatrix;

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    Role::query()->delete();
    Permission::query()->delete();
    app(PermissionRegistrar::class)->forgetCachedPermissions();
});

function authSeedRoles(): void
{
    app(RolesAndPermissionsSeeder::class)->run();
}

/** @return list<string> */
function authPermissionsOf(string $role): array
{
    return Role::findByName($role, 'web')->permissions->pluck('name')->sort()->values()->all();
}

it('seeds exactly the 24 permissions of 13 §7.1 on the web guard', function (): void {
    authSeedRoles();

    expect(Permission::query()->count())->toBe(24)
        ->and(Permission::query()->pluck('name')->all())->toEqualCanonicalizing(PermissionMatrix::ALL)
        ->and(Permission::query()->where('guard_name', '!=', 'web')->count())->toBe(0)
        ->and(array_map(static fn (PermissionName $p): string => $p->value, PermissionName::cases()))->toBe(PermissionMatrix::ALL);
});

it('seeds the five staff roles', function (): void {
    authSeedRoles();

    expect(Role::query()->pluck('name')->all())->toEqualCanonicalizing(['owner', 'admin', 'estimator', 'production', 'support'])
        ->and(Role::query()->where('guard_name', '!=', 'web')->count())->toBe(0);
});

dataset('role matrix', function (): array {
    $rows = [];
    foreach (PermissionMatrix::roles() as $role => $names) {
        $rows[$role] = [$role, $names];
    }

    return $rows;
});

it('grants each role exactly its matrix row', function (string $role, array $expected): void {
    authSeedRoles();

    expect(authPermissionsOf($role))->toBe(collect($expected)->sort()->values()->all());
})->with('role matrix');

it('keeps StaffRole::permissions() in step with the seeded matrix', function (string $role, array $expected): void {
    $names = array_map(static fn (PermissionName $p): string => $p->value, StaffRole::from($role)->permissions());

    expect($names)->toEqualCanonicalizing($expected);
})->with('role matrix');

it('is idempotent and syncs a role back to the matrix', function (): void {
    authSeedRoles();

    $extra = Permission::findOrCreate('orders.fly', 'web');
    Role::findByName('support', 'web')->givePermissionTo($extra);
    expect(authPermissionsOf('support'))->toContain('orders.fly');

    $ids = Role::query()->orderBy('name')->pluck('id')->all();
    authSeedRoles();

    expect(Permission::query()->where('name', '!=', 'orders.fly')->count())->toBe(24)
        ->and(Role::query()->count())->toBe(5)
        ->and(Role::query()->orderBy('name')->pluck('id')->all())->toBe($ids)
        ->and(authPermissionsOf('support'))->not->toContain('orders.fly')
        ->and(authPermissionsOf('support'))->toHaveCount(4);
});

it('ensureSeeded seeds a fresh database and leaves a seeded one alone', function (): void {
    expect(Role::query()->count())->toBe(0);

    RolesAndPermissionsSeeder::ensureSeeded();
    expect(Role::query()->count())->toBe(5)->and(Permission::query()->count())->toBe(24);

    $ids = Role::query()->orderBy('name')->pluck('id')->all();
    RolesAndPermissionsSeeder::ensureSeeded();
    expect(Role::query()->orderBy('name')->pluck('id')->all())->toBe($ids);
});

it('resets the permission cache after its transaction has closed', function (): void {
    authSeedRoles();

    // The writes forget the cache themselves, but inside the transaction a concurrent request could
    // re-fill it with uncommitted-era data; the last reset must therefore happen outside it.
    $base = DB::transactionLevel();
    $levels = [];
    Event::listen([KeyForgotten::class, KeyForgetFailed::class], function (KeyForgotten|KeyForgetFailed $event) use (&$levels): void {
        if ($event->key === config('permission.cache.key')) {
            $levels[] = DB::transactionLevel();
        }
    });

    authSeedRoles();

    expect($levels)->not->toBeEmpty()->and(end($levels))->toBe($base);
});

it('does not serve a stale cached permission set after the run', function (): void {
    authSeedRoles();
    $user = User::factory()->support()->create();

    // Grant an extra permission behind the package's back (no model events) and warm the cache with it.
    DB::table('role_has_permissions')->insert([
        'role_id' => Role::findByName('support', 'web')->id,
        'permission_id' => Permission::findByName('production.manage', 'web')->id,
    ]);
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($user->fresh()->hasPermissionTo('production.manage'))->toBeTrue();

    authSeedRoles();

    expect($user->fresh()->hasPermissionTo('production.manage'))->toBeFalse()
        ->and($user->fresh()->hasPermissionTo('orders.view'))->toBeTrue();
});
