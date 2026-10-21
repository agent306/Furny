<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Gate;

$gates = ['orders.cancel_late', 'staff.manage_owners', 'settings.change_currency', 'settings.manage_restricted', 'data.delete'];

it('defines the five owner abilities', function () use ($gates): void {
    expect(array_map(static fn (OwnerGate $g): string => $g->value, OwnerGate::cases()))->toBe($gates);
});

it('lets an active owner pass owner and all five abilities', function () use ($gates): void {
    $owner = User::factory()->owner()->create();

    expect(Gate::forUser($owner)->allows('owner'))->toBeTrue();
    foreach ($gates as $ability) {
        expect(Gate::forUser($owner)->allows($ability))->toBeTrue("owner should pass {$ability}");
    }
});

it('denies an admin the owner gate and all five abilities', function () use ($gates): void {
    $admin = User::factory()->admin()->create();

    expect(Gate::forUser($admin)->allows('owner'))->toBeFalse();
    foreach ($gates as $ability) {
        expect(Gate::forUser($admin)->allows($ability))->toBeFalse("admin should fail {$ability}");
    }
});

it('denies an inactive owner and a customer', function () use ($gates): void {
    $inactive = User::factory()->owner()->inactive()->create();
    $customer = User::factory()->create();

    foreach ([$inactive, $customer] as $user) {
        expect(Gate::forUser($user)->allows('owner'))->toBeFalse();
        foreach ($gates as $ability) {
            expect(Gate::forUser($user)->allows($ability))->toBeFalse();
        }
    }
});

it('denies a customer who was given the owner role by mistake', function (): void {
    $customer = User::factory()->create();
    $customer->assignRole('owner');

    expect(Gate::forUser($customer)->allows('owner'))->toBeFalse();
});

it('lets an active estimator use the permission gates but denies an inactive one everything', function (): void {
    $active = User::factory()->estimator()->create();
    $inactive = User::factory()->estimator()->inactive()->create();

    expect(Gate::forUser($active)->allows('orders.view'))->toBeTrue()
        ->and(Gate::forUser($active)->allows('production.manage'))->toBeFalse()
        ->and(Gate::forUser($inactive)->allows('orders.view'))->toBeFalse()
        ->and($inactive->can('orders.view'))->toBeFalse();
});

it('has no blanket bypass for owners (customer ownership checks still apply)', function (): void {
    Gate::define('probe', static fn (User $user): bool => false);

    expect(Gate::forUser(User::factory()->owner()->create())->allows('probe'))->toBeFalse();
});

it('exposes the owner abilities and permission names to the frontend', function () use ($gates): void {
    $owner = User::factory()->owner()->create();
    $admin = User::factory()->admin()->create();
    $support = User::factory()->support()->create();
    $customer = User::factory()->create();

    expect($owner->abilities())->toBe($gates)
        ->and($admin->abilities())->toBe([])
        ->and($customer->abilities())->toBe([])
        ->and($owner->permissionNames())->toHaveCount(24)
        ->and($support->permissionNames())->toBe(['customers.view', 'messages.post', 'orders.confirm', 'orders.view'])
        ->and($customer->permissionNames())->toBe([]);
});

it('never lets a customer pass a staff permission, even with a role or direct permission attached by mistake', function (): void {
    $viaRole = User::factory()->create();
    $viaRole->assignRole('estimator');
    $direct = User::factory()->create();
    $direct->givePermissionTo('orders.view');
    $both = User::factory()->create();
    $both->assignRole('owner');
    $both->givePermissionTo('quotes.view_costs');

    foreach ([$viaRole, $direct, $both] as $customer) {
        expect($customer->isStaff())->toBeFalse()
            ->and(Gate::forUser($customer)->allows('orders.view'))->toBeFalse()
            ->and($customer->can('orders.view'))->toBeFalse()
            ->and(Gate::forUser($customer)->allows('quotes.view_costs'))->toBeFalse()
            ->and(Gate::forUser($customer)->allows('owner'))->toBeFalse();
    }
});

it('does not affect customer abilities that are not staff permissions', function (): void {
    Gate::define('probe-own-thing', static fn (User $user): bool => true);

    expect(Gate::forUser(User::factory()->create())->allows('probe-own-thing'))->toBeTrue();
});
