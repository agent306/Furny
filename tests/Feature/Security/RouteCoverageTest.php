<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\PermissionName;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\AssertionFailedError;
use Tests\Support\Routing\AccessProbe;
use Tests\Support\Routing\AccessStubs;
use Tests\Support\Routing\RouteInventory;

const AUDIENCES = ['guest', 'customer', 'staff', 'any', 'public', 'webhook'];

it('lists every route in the access map', function (): void {
    $missing = array_values(array_diff(
        array_filter(array_column(RouteInventory::routes(), 'name')),
        array_keys(RouteInventory::accessMap()),
    ));

    expect($missing)->toBe([]);
});

it('lists no route that does not exist', function (): void {
    $stale = array_values(array_diff(
        array_keys(RouteInventory::accessMap()),
        array_filter(array_column(RouteInventory::routes(), 'name')),
    ));

    expect($stale)->toBe([]);
});

it('describes each entry with a known audience, permission and gate', function (): void {
    $permissions = array_column(PermissionName::cases(), 'value');
    $gates = array_column(OwnerGate::cases(), 'value');

    foreach (RouteInventory::accessMap() as $name => $entry) {
        expect($entry)->toHaveKeys(['audience', 'permission', 'gate'], $name)
            ->and(array_keys($entry))->toBe(['audience', 'permission', 'gate'])
            ->and($entry['audience'])->toBeIn(AUDIENCES)
            ->and($entry['permission'] === null || in_array($entry['permission'], $permissions, true))->toBeTrue("{$name}: unknown permission")
            ->and($entry['gate'] === null || in_array($entry['gate'], $gates, true))->toBeTrue("{$name}: unknown gate");

        if ($entry['permission'] !== null || $entry['gate'] !== null) {
            expect($entry['audience'])->toBe('staff', "{$name}: only staff routes need a permission or gate");
        }
    }
});

it('gives every route the access its map entry promises', function (string $name): void {
    (new AccessProbe($this))->check($name, RouteInventory::accessMap()[$name]);
})->with(fn (): array => array_keys(RouteInventory::accessMap()));

describe('the probe itself', function (): void {
    beforeEach(function (): void {
        AccessStubs::register();
    });

    it('accepts a staff route guarded by the permission its entry names', function (): void {
        Route::middleware([...AccessStubs::ADMIN, 'can:quotes.create'])->get('/admin/_permission-stub', static fn (): string => 'ok')->name('admin.permission-stub');
        AccessStubs::refresh();

        (new AccessProbe($this))->check('admin.permission-stub', ['audience' => 'staff', 'permission' => 'quotes.create', 'gate' => null]);
        expect(true)->toBeTrue();
    });

    it('rejects a staff route that does not enforce the permission its entry names', function (): void {
        Route::middleware(AccessStubs::ADMIN)->get('/admin/_open-stub', static fn (): string => 'ok')->name('admin.open-stub');
        AccessStubs::refresh();

        expect(fn () => (new AccessProbe($this))->check('admin.open-stub', ['audience' => 'staff', 'permission' => 'quotes.create', 'gate' => null]))
            ->toThrow(AssertionFailedError::class, 'does not get 403');
    });

    it('accepts and rejects an owner-gate route', function (): void {
        Route::middleware([...AccessStubs::ADMIN, 'can:data.delete'])->get('/admin/_gate-stub', static fn (): string => 'ok')->name('admin.gate-stub');
        Route::middleware(AccessStubs::ADMIN)->get('/admin/_ungated-stub', static fn (): string => 'ok')->name('admin.ungated-stub');
        AccessStubs::refresh();

        (new AccessProbe($this))->check('admin.gate-stub', ['audience' => 'staff', 'permission' => null, 'gate' => 'data.delete']);

        expect(fn () => (new AccessProbe($this))->check('admin.ungated-stub', ['audience' => 'staff', 'permission' => null, 'gate' => 'data.delete']))
            ->toThrow(AssertionFailedError::class);
    });

    it('rejects an entry whose audience does not match the route middleware', function (): void {
        expect(fn () => (new AccessProbe($this))->check('customer.dashboard', ['audience' => 'staff', 'permission' => null, 'gate' => null]))
            ->toThrow(AssertionFailedError::class, 'does not match the audience');
    });

    it('rejects a route that is missing from the app', function (): void {
        expect(fn () => (new AccessProbe($this))->check('customer.nowhere', ['audience' => 'customer', 'permission' => null, 'gate' => null]))
            ->toThrow(AssertionFailedError::class, 'does not exist');
    });
});
