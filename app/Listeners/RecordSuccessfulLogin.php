<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Domain\Identity\Models\User;
use App\Http\Middleware\TrackSession;
use App\Support\Auth\RecentAuthentication;
use App\Support\Auth\UserAgentSummary;
use App\Support\Privacy\Mask;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\SessionGuard;
use Illuminate\Support\Facades\Auth;

/**
 * Login audit and session stamps (13 §5.4 step 3).
 *
 * The `Login` event fires before Fortify regenerates the session id, so this listener does not register the
 * session: it leaves the stamps (`auth.login_at`, `auth.method`, `auth.remember`) in the session, which survives
 * the regeneration, and `TrackSession` registers the new id with them at the end of the request.
 *
 * The same event fires when the remember cookie signs a user in again. That is not a fresh authentication, so it
 * records the method `remember` and no `auth.login_at`: a revived cookie must not pass `recent.auth`.
 */
final class RecordSuccessfulLogin
{
    public function handle(Login $event): void
    {
        $user = $event->user;

        if (! $user instanceof User) {
            return;
        }

        $guard = Auth::guard($event->guard);
        $viaRemember = $guard instanceof SessionGuard && $guard->viaRemember();
        $method = $viaRemember ? 'remember' : 'password';
        $request = request();

        User::withoutTimestamps(static fn (): bool => $user->forceFill(['last_login_at' => now()])->saveQuietly());

        if ($request->hasSession()) {
            $session = $request->session();

            if (! $viaRemember) {
                $session->put(RecentAuthentication::LOGIN_KEY, now()->getTimestamp());
            }

            $session->put(TrackSession::METHOD_KEY, $method);
            $session->put(TrackSession::REMEMBER_KEY, $event->remember);
        }

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('auth.login')
            ->withProperties([
                'method' => $method,
                'ip' => Mask::ip((string) $request->ip()),
                'ua' => UserAgentSummary::from((string) $request->userAgent()),
            ])
            ->log('auth.login');
    }
}
