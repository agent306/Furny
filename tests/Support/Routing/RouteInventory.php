<?php

declare(strict_types=1);

namespace Tests\Support\Routing;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;

/**
 * The routes of the running app as `php artisan route:list --json` reports them, without the vendor
 * dashboards and framework routes that are gated elsewhere, and the access map of 13 §20.1.
 */
final class RouteInventory
{
    /** Name patterns of vendor and framework routes: Horizon, Pulse, Telescope, Boost, Livewire, local storage. */
    private const array VENDOR_NAMES = [
        'horizon.*', 'pulse', 'telescope*', 'storage.local*', 'boost.*', 'livewire.*', 'default-livewire.*',
    ];

    /** The same for their unnamed routes (an app route always has a name), and the framework's health check. */
    private const array VENDOR_URIS = [
        'up', 'horizon', 'horizon/*', 'pulse', 'pulse/*', 'telescope', 'telescope/*', '_boost/*', '_inertia/*', 'livewire-*', 'storage/*',
    ];

    /** Route name prefixes of master 6.6, and Fortify's own names. */
    public const array ALLOWED_NAME_PREFIXES = [
        'customer.', 'admin.', 'api.', 'auth.', 'account.', 'staff.', 'legal.', 'media.', 'health.', 'webhooks.', 'links.', 'notifications.', 'csp.',
        'login', 'logout', 'register', 'password.', 'verification.', 'two-factor.', 'user-profile-information.', 'user-password.',
        'welcome', 'manifest', 'fallback', 'unmatched.',
    ];

    /**
     * @return array<string, array{audience: string, permission: ?string, gate: ?string}>
     */
    public static function accessMap(): array
    {
        /** @var array<string, array{audience: string, permission: ?string, gate: ?string}> */
        return require __DIR__.'/../../Feature/Security/route-access.php';
    }

    /**
     * @return list<array{name: ?string, uri: string, methods: list<string>}>
     */
    public static function routes(): array
    {
        Artisan::call('route:list', ['--json' => true]);

        /** @var list<array{method: string, uri: string, name: ?string}> $listed */
        $listed = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $routes = [];

        foreach ($listed as $route) {
            if (self::isVendor($route['name'], $route['uri'])) {
                continue;
            }

            $routes[] = [
                'name' => $route['name'],
                'uri' => $route['uri'],
                'methods' => array_values(array_filter(explode('|', $route['method']), static fn (string $method): bool => $method !== 'HEAD')),
            ];
        }

        return $routes;
    }

    public static function isVendor(?string $name, string $uri): bool
    {
        return $name !== null ? Str::is(self::VENDOR_NAMES, $name) : Str::is(self::VENDOR_URIS, $uri);
    }
}
