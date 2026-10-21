<?php

declare(strict_types=1);

use App\Http\Middleware\EnforceAbsoluteSessionLifetime;
use App\Http\Middleware\EnsureContactVerified;
use App\Http\Middleware\EnsureCustomerOnboarded;
use App\Http\Middleware\EnsureTwoFactorEnrolled;
use App\Http\Middleware\EnsureUserIsActive;
use App\Http\Middleware\EnsureUserType;
use App\Http\Middleware\RequireRecentAuthentication;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Route;
use Tests\Support\Routing\AccessStubs;
use Tests\Support\Routing\RouteInventory;

/** Route name prefixes of master 6.6, and Fortify's own names. */
const ALLOWED_ROUTE_PREFIXES = [
    'customer.', 'admin.', 'api.', 'auth.', 'account.', 'staff.', 'legal.', 'media.', 'health.', 'webhooks.', 'links.', 'notifications.', 'csp.',
    'login', 'logout', 'register', 'password.', 'verification.', 'two-factor.', 'user-profile-information.', 'user-password.',
    'welcome', 'manifest', 'fallback', 'unmatched.',
];

it('registers the middleware aliases of 13 section 1', function (): void {
    expect(app(Router::class)->getMiddleware())->toMatchArray([
        'active' => EnsureUserIsActive::class,
        'customer' => EnsureUserType::class.':customer',
        'staff' => EnsureUserType::class.':staff',
        'onboarded' => EnsureCustomerOnboarded::class,
        'verified.contact' => EnsureContactVerified::class,
        '2fa.enrolled' => EnsureTwoFactorEnrolled::class,
        'session.absolute' => EnforceAbsoluteSessionLifetime::class,
        'recent.auth' => RequireRecentAuthentication::class,
    ]);
});

it('puts the customer routes in the customer group', function (): void {
    expect(Route::getRoutes()->getByName('customer.dashboard')->gatherMiddleware())->toBe(AccessStubs::CUSTOMER)
        ->and(AccessStubs::CUSTOMER)->toBe(['web', 'auth', 'active', 'customer', 'onboarded']);
});

it('puts the admin routes in the admin group under /admin', function (): void {
    $route = Route::getRoutes()->getByName('admin.dashboard');

    expect($route->gatherMiddleware())->toBe(AccessStubs::ADMIN)
        ->and(AccessStubs::ADMIN)->toBe(['web', 'auth', 'active', 'staff', '2fa.enrolled', 'session.absolute'])
        ->and($route->uri())->toBe('admin');
});

it('gives every non-vendor route a name', function (): void {
    $unnamed = array_map(
        static fn (array $route): string => implode('|', $route['methods']).' '.$route['uri'],
        array_filter(RouteInventory::routes(), static fn (array $route): bool => $route['name'] === null),
    );

    expect(array_values($unnamed))->toBe([]);
});

it('has no two routes with the same method and path', function (): void {
    $seen = [];
    $duplicates = [];

    foreach (RouteInventory::routes() as $route) {
        foreach ($route['methods'] as $method) {
            $key = $method.' /'.ltrim($route['uri'], '/');

            if (isset($seen[$key])) {
                $duplicates[] = $key;
            }

            $seen[$key] = true;
        }
    }

    expect($duplicates)->toBe([]);
});

it('has no two routes with the same name', function (): void {
    $names = array_values(array_filter(array_column(RouteInventory::routes(), 'name')));

    expect(array_diff_assoc($names, array_unique($names)))->toBe([]);
});

it('names every route with an allowed prefix', function (): void {
    $offenders = array_filter(
        array_column(RouteInventory::routes(), 'name'),
        static function (?string $name): bool {
            foreach (ALLOWED_ROUTE_PREFIXES as $prefix) {
                if ($name !== null && str_starts_with($name, $prefix)) {
                    return false;
                }
            }

            return true;
        },
    );

    expect(array_values($offenders))->toBe([]);
});

it('detects an unlisted prefix (the guard itself works)', function (): void {
    expect(RouteInventory::isVendor('horizon.index', 'horizon/{view?}'))->toBeTrue()
        ->and(RouteInventory::isVendor('customer.dashboard', 'dashboard'))->toBeFalse()
        ->and(RouteInventory::isVendor(null, 'up'))->toBeTrue()
        ->and(RouteInventory::isVendor(null, 'livewire-abc123/livewire.js'))->toBeTrue()
        ->and(RouteInventory::isVendor(null, 'orders'))->toBeFalse();
});
