<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Customers have no two-factor authentication (13 §5.10): every Fortify `two-factor.*` route answers 403 for them.
 * Fortify's routes stay registered as they are (no `Fortify::ignoreRoutes()`), so the check sits in the `web` group and
 * matches the routes by name. It runs before the route's own `password.confirm`, so a customer is not even asked for a
 * password. The challenge routes (`two-factor.login*`) are `two-factor.*` too: a customer who is signed in gets 403
 * there as well (13 §5.10, 14 §3.1: every `two-factor.*` route). A visitor who is not signed in has no user, and is not
 * touched.
 */
final class PreventCustomerTwoFactor
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($request->routeIs('two-factor.*') && $user instanceof User && $user->isCustomer()) {
            abort(403);
        }

        return $next($request);
    }
}
