<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use App\Support\Auth\ForcedLogout;
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
 * Before the request it signs out a session that was revoked: a request that was in flight when the user signed
 * the device out saves the session payload again when it ends, so the payload alone does not say the device is
 * signed out. After the request it records the session, so a request that ended the session (logout, a forced
 * logout) is not recorded, and the request that signs a user in registers the session it signed them in on. The
 * registry is a convenience for the user: when it cannot be reached the request still succeeds.
 */
final class TrackSession
{
    /** Session key the login flow sets to say how the user signed in (`password`, `otp`, `google`, `remember`; 13 §5). */
    public const string METHOD_KEY = 'auth.method';

    /** Session key the login flow sets to true when the user ticked "remember me". */
    public const string REMEMBER_KEY = 'auth.remember';

    public function __construct(private readonly SessionRegistry $registry) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->hasSession()) {
            return $next($request);
        }

        if ($this->isRevoked($request)) {
            return ForcedLogout::toLogin($request, 'session_revoked');
        }

        $response = $next($request);

        $this->track($request);

        return $response;
    }

    private function isRevoked(Request $request): bool
    {
        if (! $request->user() instanceof User) {
            return false;
        }

        try {
            return $this->registry->isRevoked($request->session()->getId());
        } catch (Throwable $e) {
            report($e);

            return false;
        }
    }

    private function track(Request $request): void
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return;
        }

        $guard = Auth::guard('web');
        $method = $request->session()->get(self::METHOD_KEY);

        try {
            $this->registry->track(
                $user,
                $request->session()->getId(),
                $request,
                $guard->viaRemember() ? 'remember' : (is_string($method) && $method !== '' ? $method : 'unknown'),
                // The remember cookie signs the user in again for 14 days, so the device stays in the list that long.
                $request->cookies->has($guard->getRecallerName()) || $request->session()->get(self::REMEMBER_KEY) === true,
            );
        } catch (Throwable $e) {
            report($e);
        }
    }
}
