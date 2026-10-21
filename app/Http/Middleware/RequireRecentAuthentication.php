<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\RecentAuthenticationRequired;
use App\Support\Auth\RecentAuthentication;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** `recent.auth` (13 §6.4): sensitive actions need a sign-in or password confirmation in the last 10 minutes. */
final class RequireRecentAuthentication
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! RecentAuthentication::passes($request)) {
            throw new RecentAuthenticationRequired;
        }

        return $next($request);
    }
}
