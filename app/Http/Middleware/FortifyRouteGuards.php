<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Settings\Settings;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards for Fortify's routes (14 §1.1, §3.1), which this app cannot decorate where they are defined because it does
 * not use `Fortify::ignoreRoutes()`. They are picked by route name, in the `web` group:
 *
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
            'register.store' => $this->register($request, $next),
            default => $next($request),
        };
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
