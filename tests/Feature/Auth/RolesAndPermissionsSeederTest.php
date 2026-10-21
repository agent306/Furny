<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use Database\Seeders\RolesAndPermissionsSeeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/** The 24 permissions of 13 §7.1, in that order. */
const ALL_PERMISSIONS = [
    'orders.view', 'orders.review', 'orders.assign', 'orders.propose_changes', 'quotes.create', 'quotes.send',
    'quotes.view_costs', 'orders.confirm', 'orders.cancel', 'orders.hold', 'orders.close', 'production.manage',
    'messages.post', 'customers.view', 'customers.manage', 'catalog.manage', 'presets.manage', 'templates.manage',
    'settings.manage', 'staff.manage', 'ai.manage', 'reports.view', 'plans.edit_any', 'audit.view',
];

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    Role::query()->delete();
    Permission::query()->delete();
    app(PermissionRegistrar::class)->forgetCachedPermissions();
});

function seedRoles(): void
{
    app(RolesAndPermissionsSeeder::class)->run();
}

/** @return list<string> */
function permissionsOf(string $role): array
{
    return Role::findByName($role, 'web')->permissions->pluck('name')->sort()->values()->all();
}

it('seeds exactly the 24 permissions of 13 §7.1 on the web guard', function (): void {
    seedRoles();

    expect(Permission::query()->count())->toBe(24)
        ->and(Permission::query()->pluck('name')->all())->toEqualCanonicalizing(ALL_PERMISSIONS)
        ->and(Permission::query()->where('guard_name', '!=', 'web')->count())->toBe(0)
        ->and(array_map(static fn (PermissionName $p): string => $p->value, PermissionName::cases()))->toBe(ALL_PERMISSIONS);
});

it('seeds the five staff roles', function (): void {
    seedRoles();

    expect(Role::query()->pluck('name')->all())->toEqualCanonicalizing(['owner', 'admin', 'estimator', 'production', 'support'])
        ->and(Role::query()->where('guard_name', '!=', 'web')->count())->toBe(0);
});

dataset('role matrix', function (): array {
    $estimator = [
        'orders.view', 'orders.review', 'orders.assign', 'orders.propose_changes', 'quotes.create', 'quotes.send',
        'quotes.view_costs', 'orders.confirm', 'orders.cancel', 'orders.hold', 'messages.post', 'customers.view',
        'presets.manage', 'plans.edit_any',
    ];

    return [
        'owner' => ['owner', ALL_PERMISSIONS],
        'admin' => ['admin', ALL_PERMISSIONS],
        'estimator' => ['estimator', $estimator],
        'production' => ['production', ['orders.view', 'orders.hold', 'production.manage', 'messages.post', 'customers.view']],
        'support' => ['support', ['orders.view', 'orders.confirm', 'messages.post', 'customers.view']],
    ];
});

it('grants each role exactly its matrix row', function (string $role, array $expected): void {
    seedRoles();

    expect(permissionsOf($role))->toBe(collect($expected)->sort()->values()->all());
})->with('role matrix');

it('keeps StaffRole::permissions() in step with the seeded matrix', function (string $role, array $expected): void {
    $names = array_map(static fn (PermissionName $p): string => $p->value, StaffRole::from($role)->permissions());

    expect($names)->toEqualCanonicalizing($expected);
})->with('role matrix');

it('is idempotent and syncs a role back to the matrix', function (): void {
    seedRoles();

    $extra = Permission::findOrCreate('orders.fly', 'web');
    Role::findByName('support', 'web')->givePermissionTo($extra);
    expect(permissionsOf('support'))->toContain('orders.fly');

    $ids = Role::query()->orderBy('name')->pluck('id')->all();
    seedRoles();

    expect(Permission::query()->where('name', '!=', 'orders.fly')->count())->toBe(24)
        ->and(Role::query()->count())->toBe(5)
        ->and(Role::query()->orderBy('name')->pluck('id')->all())->toBe($ids)
        ->and(permissionsOf('support'))->not->toContain('orders.fly')
        ->and(permissionsOf('support'))->toHaveCount(4);
});

it('ensureSeeded seeds a fresh database and leaves a seeded one alone', function (): void {
    expect(Role::query()->count())->toBe(0);

    RolesAndPermissionsSeeder::ensureSeeded();
    expect(Role::query()->count())->toBe(5)->and(Permission::query()->count())->toBe(24);

    $ids = Role::query()->orderBy('name')->pluck('id')->all();
    RolesAndPermissionsSeeder::ensureSeeded();
    expect(Role::query()->orderBy('name')->pluck('id')->all())->toBe($ids);
});
