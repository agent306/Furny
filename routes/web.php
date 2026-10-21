<?php

declare(strict_types=1);

use App\Http\Controllers\LegalController;
use App\Http\Controllers\ManifestController;
use App\Http\Controllers\WelcomeController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// Public pages (14 §2). The customer and admin route files are registered in bootstrap/app.php.
Route::get('/', WelcomeController::class)->name('welcome');
Route::get('terms', [LegalController::class, 'terms'])->name('legal.terms');
Route::get('privacy', [LegalController::class, 'privacy'])->name('legal.privacy');
// Stateless: the manifest is the same for everyone and cacheable (`public`), so it must not start a
// session or set a cookie.
Route::get('manifest.webmanifest', ManifestController::class)
    ->name('manifest')
    ->withoutMiddleware([
        EncryptCookies::class,
        AddQueuedCookiesToResponse::class,
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
    ]);

// A URL that matches nothing is a 404 raised inside the `web` group, so the Error page renders in the
// layout of the signed-in user, with their session and the shared props (10 §4.10).
Route::fallback(static fn () => abort(404))->name('fallback');
