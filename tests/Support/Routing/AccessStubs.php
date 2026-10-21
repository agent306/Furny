<?php

declare(strict_types=1);

namespace Tests\Support\Routing;

use Illuminate\Support\Facades\Route;

/**
 * Routes that later tasks add (the onboarding wizard, the 2FA page, re-authentication) and the middleware
 * tests need as redirect targets. Registered in the test only, and only when the app has no such route yet.
 */
final class AccessStubs
{
    /** The middleware of the admin group (13 §1). */
    public const array ADMIN = ['web', 'auth', 'active', 'staff', '2fa.enrolled', 'session.absolute'];

    /** The middleware of the customer group (13 §1). */
    public const array CUSTOMER = ['web', 'auth', 'active', 'customer', 'onboarded'];

    public static function register(): void
    {
        self::once('customer.onboarding.show', '/onboarding', ['web', 'auth']);
        self::once('admin.security.two-factor', '/admin/security/two-factor', self::ADMIN);
        self::once('auth.reauthenticate', '/auth/reauthenticate', ['web', 'auth']);
    }

    /**
     * @param  list<string>  $middleware
     */
    public static function once(string $name, string $uri, array $middleware): void
    {
        if (! Route::has($name)) {
            Route::middleware($middleware)->get($uri, static fn (): string => 'stub')->name($name);
        }

        self::refresh();
    }

    /** Routes registered after boot are not in the name lookup until it is rebuilt. */
    public static function refresh(): void
    {
        Route::getRoutes()->refreshNameLookups();
    }
}
