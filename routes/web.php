<?php

declare(strict_types=1);

use App\Http\Controllers\Account\SessionController;
use App\Http\Controllers\CspReportController;
use App\Http\Controllers\LegalController;
use App\Http\Controllers\ManifestController;
use App\Http\Controllers\NotFoundController;
use App\Http\Controllers\WelcomeController;
use App\Support\Http\StatelessRoute;
use Illuminate\Support\Facades\Route;

// Public pages (14 §2). The customer and admin route files are registered in bootstrap/app.php.
Route::get('/', WelcomeController::class)->name('welcome');
Route::get('terms', [LegalController::class, 'terms'])->name('legal.terms');
Route::get('privacy', [LegalController::class, 'privacy'])->name('legal.privacy');
// Stateless: the manifest is the same for everyone and cacheable (`public`), so it must not start a
// session or set a cookie.
Route::get('manifest.webmanifest', ManifestController::class)
    ->name('manifest')
    ->withoutMiddleware(StatelessRoute::WITHOUT);

// Browsers post CSP violation reports here (13 §12.1): no session, no cookie, no CSRF token.
Route::post('csp-report', CspReportController::class)
    ->name('csp.report')
    ->middleware('throttle:csp-report')
    ->withoutMiddleware(StatelessRoute::WITHOUT);

// Account security, for both audiences (14 §3.3). Signing out one's own devices is not a sensitive action; signing
// out all the others is (`recent.auth`).
Route::middleware(['auth', 'active'])->prefix('account')->name('account.')->group(function (): void {
    Route::delete('sessions/{sessionKey}', [SessionController::class, 'destroy'])->name('sessions.destroy');
    Route::delete('sessions', [SessionController::class, 'destroyOthers'])
        ->middleware('recent.auth')
        ->name('sessions.destroy-others');
});

// A URL that matches nothing is a 404 raised inside the `web` group, so the Error page renders in the
// layout of the signed-in user, with their session and the shared props (10 §4.10).
Route::fallback(NotFoundController::class)->name('fallback');
