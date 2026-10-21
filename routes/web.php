<?php

declare(strict_types=1);

use App\Http\Controllers\Account\GoogleLinkController;
use App\Http\Controllers\Account\PhoneController;
use App\Http\Controllers\Account\SessionController;
use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\Auth\PhoneOtpController;
use App\Http\Controllers\Auth\ReauthenticateController;
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

// Google sign-in (13 §5.3). Open to everybody: a guest signs in, a signed-in user links Google or confirms their
// identity, and the intent decides which. `active` signs out a deactivated user first. Hidden (404) unless
// `features.google_login`.
Route::middleware(['throttle:oauth', 'active'])->prefix('auth/google')->name('auth.google.')->group(function (): void {
    Route::get('redirect', [GoogleController::class, 'redirect'])->name('redirect');
    Route::get('callback', [GoogleController::class, 'callback'])->name('callback');
});

// Sign-in and sign-up with a phone code (13 §5.2, 14 §3.2): for guests, except the status poll, which reads the
// challenge of the session whoever holds it. The sends and verifications are limited inside `SendOtp` and `VerifyOtp`
// (13 §4); finishing a sign-up counts as a registration.
Route::get('login/phone', [PhoneOtpController::class, 'create'])->middleware('guest')->name('auth.otp.create');
Route::prefix('auth/otp')->name('auth.otp.')->group(function (): void {
    Route::middleware('guest')->group(function (): void {
        Route::post('send', [PhoneOtpController::class, 'send'])->name('send');
        Route::get('verify', [PhoneOtpController::class, 'showVerify'])->name('verify.show');
        Route::post('verify', [PhoneOtpController::class, 'verify'])->name('verify');
        Route::post('resend', [PhoneOtpController::class, 'resend'])->name('resend');
        Route::get('complete', [PhoneOtpController::class, 'showComplete'])->name('complete.show');
        Route::post('complete', [PhoneOtpController::class, 'complete'])->middleware('throttle:register')->name('complete');
    });

    Route::get('status', [PhoneOtpController::class, 'status'])->name('status');
});

// Account security, for both audiences (14 §3.3). Signing out one's own devices is not a sensitive action; signing
// out all the others is (`recent.auth`).
Route::middleware(['auth', 'active'])->prefix('account')->name('account.')->group(function (): void {
    Route::delete('sessions/{sessionKey}', [SessionController::class, 'destroy'])->name('sessions.destroy');
    Route::delete('sessions', [SessionController::class, 'destroyOthers'])
        ->middleware('recent.auth')
        ->name('sessions.destroy-others');
    Route::delete('google', [GoogleLinkController::class, 'destroy'])
        ->middleware('recent.auth')
        ->name('google.unlink');
    // Adding or changing the phone number (13 §5.7): a code to the new number, then the number is the user's own.
    Route::post('phone/otp', [PhoneController::class, 'send'])->name('phone.send');
    Route::post('phone/verify', [PhoneController::class, 'verify'])->name('phone.verify');
});

// Confirming who is at the keyboard without a password (13 §6.4): a phone code or Google. Users who have a password
// confirm it instead (`password.confirm`).
Route::middleware(['auth', 'active'])->prefix('auth/reauthenticate')->group(function (): void {
    Route::get('', [ReauthenticateController::class, 'show'])->name('auth.reauthenticate');
    Route::post('', [ReauthenticateController::class, 'store'])->name('auth.reauthenticate.store');
});

// A URL that matches nothing is a 404 raised inside the `web` group, so the Error page renders in the
// layout of the signed-in user, with their session and the shared props (10 §4.10).
Route::fallback(NotFoundController::class)->name('fallback');
