<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionRegistry;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * `track.session` (13 §6.3): keeps the session registry up to date. The first time an authenticated session is
 * seen it is registered, afterwards its activity is recorded (at most once a minute). Guests, and routes without
 * a session (the manifest, CSP reports), leave no trace.
 *
 * It runs after the rest of the request, so a request that ended the session (logout, a forced logout) is not
 * recorded, and the request that signs a user in registers the session it signed them in on. The registry is a
 * convenience for the user: when it cannot be written the request still succeeds.
 */
final class TrackSession
{
    /** Session key a login flow may set to say how the user signed in (`password`, `otp`, `google`). */
    public const string METHOD_KEY = 'auth.login_method';

    public function __construct(private readonly SessionRegistry $registry) {}

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if ($request->hasSession()) {
            $this->track($request);
        }

        return $response;
    }

    private function track(Request $request): void
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return;
        }

        $viaRemember = Auth::guard('web')->viaRemember();
        $method = $request->session()->get(self::METHOD_KEY);

        try {
            $this->registry->track(
                $user,
                $request->session()->getId(),
                $request,
                $viaRemember ? 'remember' : (is_string($method) && $method !== '' ? $method : 'unknown'),
                $viaRemember,
            );
        } catch (Throwable $e) {
            report($e);
        }
    }
}
