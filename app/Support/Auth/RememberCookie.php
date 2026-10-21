<?php

declare(strict_types=1);

namespace App\Support\Auth;

use App\Domain\Identity\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * The remember cookie of the browser that made the request, after a revocation rotated the user's remember token
 * (13 §6.3). The cookie it holds carries the old token and would stop working, so a browser that has one is given
 * the new token, exactly as the guard writes it at login, without signing in again: no `Login` event, no new
 * session id.
 */
final class RememberCookie
{
    public static function renew(Request $request, User $user): void
    {
        $guard = Auth::guard('web');

        if (! $request->cookies->has($guard->getRecallerName())) {
            return;
        }

        $guard->getCookieJar()->queue($guard->getCookieJar()->make(
            $guard->getRecallerName(),
            $user->getAuthIdentifier().'|'.$user->getRememberToken().'|'.$guard->hashPasswordForCookie($user->getAuthPassword()),
            (int) config('auth.guards.web.remember'),
        ));
    }
}
