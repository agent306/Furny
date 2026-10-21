<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Auth;
use Laravel\Fortify\Contracts\LogoutResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards for Fortify's routes (14 §1.1, §3.1), which this app cannot decorate where they are defined because it does
 * not use `Fortify::ignoreRoutes()`. They are picked by route name, in the `web` group:
 *
 * - `logout`: signs out this device only (`logoutCurrentDevice`, which forgets this device's remember cookie but
 *   does not cycle the `remember_token`, as Fortify's own `logout()` does and so would end the remember cookie of
 *   every other device). "Sign out other devices" is the action that rotates the token (13 §6.3).
 * - `register.store`: refused with 403 while customer registration is closed (`auth.allow_customer_registration`),
 *   otherwise throttled by the `register` limiter. The Turnstile check is a rule of the registration action.
 */
final class FortifyRouteGuards
{
    public function __construct(
        private readonly Router $router,
        private readonly Settings $settings,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        return match ($request->route()?->getName()) {
            'logout' => $this->logout($request, $next),
            'register.store' => $this->register($request, $next),
            default => $next($request),
        };
    }

    private function logout(Request $request, Closure $next): Response
    {
        // A guest is left to the route's `auth` middleware.
        if (! $request->user() instanceof User) {
            return $next($request);
        }

        Auth::guard((string) config('fortify.guard'))->logoutCurrentDevice();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return app(LogoutResponse::class)->toResponse($request);
    }

    private function register(Request $request, Closure $next): Response
    {
        abort_unless($this->settings->auth()->allowCustomerRegistration, 403, __('auth.registration_closed'));

        return $this->throttle($request, $next, 'register');
    }

    /** Applies a named limiter the way the `throttle:` route middleware does, 429 rendering included. */
    private function throttle(Request $request, Closure $next, string $limiter): Response
    {
        $class = $this->router->getMiddleware()['throttle'];

        /** @var Response */
        return app($class)->handle($request, $next, $limiter);
    }
}
