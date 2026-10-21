<?php

declare(strict_types=1);

use App\Http\Controllers\PlainNotFoundController;
use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use App\Support\Http\ErrorPage;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            // Task 23 replaces these placeholder groups with the full customer and staff groups (13 §1).
            Route::middleware(['web', 'auth'])->name('customer.')->group(base_path('routes/customer.php'));
            Route::middleware(['web', 'auth'])->prefix('admin')->name('admin.')->group(base_path('routes/admin.php'));

            // Missing assets and API paths get a bare 404: no session, no cookie, no Inertia page.
            // Registered last, so no real route with a dot in its path is ever shadowed.
            Route::any('{path}', PlainNotFoundController::class)
                ->where('path', '(?:build|api)/.*|.*\.[A-Za-z0-9]{1,8}')
                ->name('unmatched.plain');
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Traefik (Coolify) connects from the Docker networks (13 §12.8, 17 §5.11 item 1).
        $middleware->trustProxies(
            at: env('TRUSTED_PROXIES', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1'),
            headers: Request::HEADER_X_FORWARDED_FOR
                | Request::HEADER_X_FORWARDED_HOST
                | Request::HEADER_X_FORWARDED_PORT
                | Request::HEADER_X_FORWARDED_PROTO,
        );

        // `php artisan down` must not break the health checks (17 §5.11 item 2).
        $middleware->preventRequestsDuringMaintenance(except: ['up', 'up/deep']);

        $middleware->encryptCookies(except: ['appearance']);

        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // 403/404/405/419/429/503, and 500 outside debug mode, render the Inertia `Error` page (10 §4.10).
        $exceptions->respond(ErrorPage::render(...));
    })->create();

// ICU translations live in resources/lang (15 §15.2).
return $app->useLangPath($app->resourcePath('lang'));
