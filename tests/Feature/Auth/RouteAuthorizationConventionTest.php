<?php

declare(strict_types=1);

use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Route;
use Spatie\Permission\Middleware\PermissionMiddleware;
use Spatie\Permission\Middleware\RoleMiddleware;
use Spatie\Permission\Middleware\RoleOrPermissionMiddleware;

/**
 * Spatie's route middleware checks roles and permissions without the Gate, so it would bypass the
 * inactive-staff deny and the customer deny of AuthServiceProvider (13 §7.3). Routes use `can:` and policies.
 *
 * @return list<string>
 */
function authSpatieMiddlewareOn(LaravelRoute $route): array
{
    $forbidden = [PermissionMiddleware::class, RoleMiddleware::class, RoleOrPermissionMiddleware::class];

    return array_values(array_filter(
        app(Router::class)->gatherRouteMiddleware($route),
        static fn (mixed $middleware): bool => is_string($middleware) && (
            preg_match('/^(permission|role|role_or_permission):/', $middleware) === 1
            || in_array(strtok($middleware, ':'), $forbidden, true)
        ),
    ));
}

it('uses no spatie permission, role or role_or_permission middleware on any route', function (): void {
    $offenders = [];

    foreach (Route::getRoutes() as $route) {
        foreach (authSpatieMiddlewareOn($route) as $middleware) {
            $offenders[] = $route->uri().' => '.$middleware;
        }
    }

    expect($offenders)->toBe([]);
});

it('detects the forbidden middleware (the guard itself works)', function (): void {
    Route::get('/__guard/a', static fn () => 'ok')->middleware('permission:orders.view');
    Route::get('/__guard/b', static fn () => 'ok')->middleware(RoleMiddleware::class.':owner');
    Route::get('/__guard/c', static fn () => 'ok')->middleware('role_or_permission:owner|orders.view');
    Route::get('/__guard/d', static fn () => 'ok')->middleware('can:orders.view');

    $found = [];
    foreach (Route::getRoutes() as $route) {
        if (str_starts_with($route->uri(), '__guard/')) {
            $found[$route->uri()] = authSpatieMiddlewareOn($route) !== [];
        }
    }

    expect($found)->toBe(['__guard/a' => true, '__guard/b' => true, '__guard/c' => true, '__guard/d' => false]);
});
