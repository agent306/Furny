<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use App\Support\Auth\ForcedLogout;
use App\Support\Auth\RecentAuthentication;
use App\Support\Settings\Settings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `session.absolute` (13 §6.1): staff sessions end `auth.staff_session_absolute_hours` (12 by default) after
 * sign-in, however active the user is. Customers are not affected.
 *
 * A staff session without a sign-in stamp starts its clock on the first request, so it is bounded as well.
 */
final class EnforceAbsoluteSessionLifetime
{
    public function __construct(private readonly Settings $settings) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User || ! $user->isStaff() || ! $request->hasSession()) {
            return $next($request);
        }

        $signedInAt = RecentAuthentication::timeOf($request->session()->get(RecentAuthentication::LOGIN_KEY));

        if ($signedInAt === null) {
            $request->session()->put(RecentAuthentication::LOGIN_KEY, now()->getTimestamp());

            return $next($request);
        }

        if ($signedInAt->addHours($this->settings->auth()->staffSessionAbsoluteHours)->isPast()) {
            return ForcedLogout::toLogin($request, 'auth.session_expired');
        }

        return $next($request);
    }
}
