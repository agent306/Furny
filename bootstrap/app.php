<?php

declare(strict_types=1);

use App\Http\Controllers\PlainNotFoundController;
use App\Http\Middleware\EnforceAbsoluteSessionLifetime;
use App\Http\Middleware\EnsureContactVerified;
use App\Http\Middleware\EnsureCustomerOnboarded;
use App\Http\Middleware\EnsureTwoFactorEnrolled;
use App\Http\Middleware\EnsureUserIsActive;
use App\Http\Middleware\EnsureUserType;
use App\Http\Middleware\FortifyRouteGuards;
use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\PreventCustomerTwoFactor;
use App\Http\Middleware\PreventRequiredTwoFactorDisable;
use App\Http\Middleware\RequireRecentAuthentication;
use App\Http\Middleware\SecurityHeaders;
use App\Http\Middleware\TrackSession;
use App\Support\Http\CodedValidationException;
use App\Support\Http\ErrorPage;
use App\Support\Http\InvalidInvitationLink;
use App\Support\Http\OtpErrorResponse;
use App\Support\Http\RateLimitedResponse;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Support\Facades\Route;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            // The route groups of 13 §1. Every route file registers names relative to its group.
            Route::middleware(['web', 'auth', 'active', 'customer', 'onboarded'])
                ->name('customer.')
                ->group(base_path('routes/customer.php'));

            Route::middleware(['web', 'auth', 'active', 'staff', '2fa.enrolled', 'session.absolute'])
                ->prefix('admin')
                ->name('admin.')
                ->group(base_path('routes/admin.php'));

            // The editor's JSON endpoints: session authentication and CSRF protection like the pages.
            Route::middleware(['web', 'auth', 'active', 'throttle:api'])
                ->prefix('api')
                ->name('api.')
                ->group(base_path('routes/api.php'));

            // Stateless: no `web` group, so no session, no cookie and no CSRF token. Each webhook verifies its
            // own signature (13 §14).
            Route::middleware('throttle:webhooks')
                ->prefix('webhooks')
                ->name('webhooks.')
                ->group(base_path('routes/webhooks.php'));

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

        // Outermost, so every response gets the headers: the bare 404s, health checks, stateless routes,
        // 405s and the maintenance page, not only the `web` group (13 §12.1).
        $middleware->prepend(SecurityHeaders::class);

        // Signature-verified webhooks (13 §14) and the browser's CSP reports carry no CSRF token (13 §12.3).
        $middleware->preventRequestForgery(except: ['csp-report', 'webhooks/*']);

        $middleware->alias([
            'active' => EnsureUserIsActive::class,
            'customer' => EnsureUserType::class.':customer',
            'staff' => EnsureUserType::class.':staff',
            'onboarded' => EnsureCustomerOnboarded::class,
            'verified.contact' => EnsureContactVerified::class,
            '2fa.enrolled' => EnsureTwoFactorEnrolled::class,
            'session.absolute' => EnforceAbsoluteSessionLifetime::class,
            'recent.auth' => RequireRecentAuthentication::class,
            'track.session' => TrackSession::class,
        ]);

        // Route model binding must come after every check on who the user is and whether they may be here:
        // otherwise a customer, an inactive user or an unenrolled admin would get 404 for a missing record and 403
        // (or a redirect) for an existing one, which tells them whether it exists. Each call inserts the class
        // just before SubstituteBindings, so the classes keep this order, after `auth`.
        foreach ([
            EnsureUserIsActive::class,
            EnsureUserType::class,
            EnsureCustomerOnboarded::class,
            EnsureTwoFactorEnrolled::class,
            EnforceAbsoluteSessionLifetime::class,
        ] as $accessCheck) {
            $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: $accessCheck);
        }

        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
            // A password change signs out the other sessions of a password user (13 §6.1); then the registry
            // records the session (13 §6.3).
            AuthenticateSession::class,
            TrackSession::class,
            // The limiters and the closed-registration check that Fortify's own routes cannot carry (14 §3.1).
            FortifyRouteGuards::class,
            // The two-factor rules of 13 §5.10 for Fortify's routes, which are matched by name: no customers on
            // `two-factor.*`, and no switching off for the roles that must have it.
            PreventCustomerTwoFactor::class,
            PreventRequiredTwoFactorDisable::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is(...ErrorPage::MACHINE_PATHS) || $request->expectsJson(),
        );

        // Never write secrets back into the form after a validation error (13 §16 rule 3).
        $exceptions->dontFlash([
            'password',
            'password_confirmation',
            'current_password',
            'code',
            // The reset link's secret: a refused new password must not leave it in the session as old input.
            'token',
            'cf_turnstile_response',
        ]);

        // 429: JSON for machines, a flash and a redirect back for Inertia visits (13 §10).
        $exceptions->render(RateLimitedResponse::render(...));

        // A refused phone code: JSON for machines, the errors bag of 14 §1.9 for forms (13 §4).
        $exceptions->render(OtpErrorResponse::render(...));

        // A domain refusal with a machine code (`staff.last_owner`): JSON clients get `{code, message, errors}`; forms get
        // the errors bag with the code under `code` (14 §1.8, §1.9).
        $exceptions->render(static fn (CodedValidationException $exception, Request $request) => ErrorPage::wantsMachineResponse($request)
            ? response()->json([...$exception->context, 'code' => $exception->errorCode, 'message' => collect($exception->fieldErrors())->flatten()->first(), 'errors' => $exception->fieldErrors()], 422)
            : null);

        // The link of a staff invitation with a bad signature is a page about the invitation, not a bare 403.
        $exceptions->render(InvalidInvitationLink::render(...));

        // 403/404/405/419/429/503, and 500 outside debug mode, render the Inertia `Error` page (10 §4.10).
        $exceptions->respond(ErrorPage::render(...));
    })->create();

// ICU translations live in resources/lang (15 §15.2).
return $app->useLangPath($app->resourcePath('lang'));
