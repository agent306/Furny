<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use App\Exceptions\RecentAuthenticationRequired;
use App\Rules\TurnstileToken;
use App\Support\Auth\RecentAuthentication;
use App\Support\Settings\Settings;
use Closure;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Timebox;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;
use Laravel\Fortify\Fortify;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards for Fortify's routes (14 §1.1, §3.1), which this app cannot decorate where they are defined because it does
 * not use `Fortify::ignoreRoutes()`. They are picked by route name, in the `web` group:
 *
 * - `register.store`: refused with 403 while customer registration is closed (`auth.allow_customer_registration`),
 *   otherwise throttled by the `register` limiter. The Turnstile check is a rule of the registration action.
 * - `password.email`: the Turnstile check (`password_reset`, fail open), then the `password-reset` limiter, which is
 *   silent: a request over the limit gets the same answer as any other and no mail (13 §5.5 beats 14 §3.1, which
 *   would answer 429 and tell an attacker which address they are hammering). The whole request takes the same
 *   minimum time, so neither the limit nor the mail gives the account away.
 * - `verification.send`: throttled by the `verification-resend` limiter.
 * - `user-profile-information.update`: an email that differs from the current one needs a recent authentication
 *   (13 §5.8, §6.4).
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
            'password.email' => $this->passwordEmail($request, $next),
            'verification.send' => $this->throttle($request, $next, 'verification-resend'),
            'user-profile-information.update' => $this->profile($request, $next),
            default => $next($request),
        };
    }

    private function register(Request $request, Closure $next): Response
    {
        abort_unless($this->settings->auth()->allowCustomerRegistration, 403, __('auth.registration_closed'));

        return $this->throttle($request, $next, 'register');
    }

    private function passwordEmail(Request $request, Closure $next): Response
    {
        return (new Timebox)->call(function () use ($request, $next): Response {
            Validator::make($request->all(), [
                'cf_turnstile_response' => [new TurnstileToken('password_reset', failOpen: true)],
            ])->validate();

            $reached = false;

            try {
                return $this->throttle($request, function (Request $request) use ($next, &$reached): Response {
                    $reached = true;

                    return $next($request);
                }, 'password-reset');
            } catch (ThrottleRequestsException $exception) {
                // Only the limiter's refusal is swallowed; an exception from further in is not its business.
                if ($reached) {
                    throw $exception;
                }
            }

            // Over the limit: the answer of every other request, once the field has been checked like theirs.
            $request->validate([Fortify::email() => 'required|email']);

            return app(SuccessfulPasswordResetLinkRequestResponse::class, ['status' => Password::RESET_THROTTLED])->toResponse($request);
        }, (int) config('auth.password_reset_timebox_microseconds'));
    }

    private function profile(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // A guest is for the `auth` middleware that follows to turn away.
        if ($user instanceof User && $this->changesEmail($request, $user) && ! RecentAuthentication::passes($request)) {
            throw new RecentAuthenticationRequired;
        }

        return $next($request);
    }

    /**
     * Whether the form sends an email other than the user's own. An email that is not sent is not changed; one that
     * is empty clears it. Anything that is not text is a change, for validation to refuse afterwards.
     */
    private function changesEmail(Request $request, User $user): bool
    {
        if (! $request->has(Fortify::username())) {
            return false;
        }

        $email = $request->input(Fortify::username());

        if ($email !== null && ! is_string($email)) {
            return true;
        }

        $email = mb_strtolower(trim((string) $email));

        return ($email === '' ? null : $email) !== $user->email;
    }

    /** Applies a named limiter the way the `throttle:` route middleware does, 429 rendering included. */
    private function throttle(Request $request, Closure $next, string $limiter): Response
    {
        $class = $this->router->getMiddleware()['throttle'];

        /** @var Response */
        return app($class)->handle($request, $next, $limiter);
    }
}
