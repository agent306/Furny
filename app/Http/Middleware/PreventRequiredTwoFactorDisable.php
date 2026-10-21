<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Owners and admins cannot turn their two-factor authentication off (13 §5.10): `DELETE /user/two-factor-authentication`
 * (route `two-factor.disable`) answers 403 `auth.errors.2fa_required` for them. It is in the `web` group because
 * Fortify's routes are registered by the package, and matches the route by name. The roles are read on every request, so a
 * role change applies at once; another role may switch its own off. Regenerating the recovery codes stays allowed.
 */
final class PreventRequiredTwoFactorDisable
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($request->routeIs('two-factor.disable') && $user instanceof User && $user->requiresTwoFactor()) {
            abort(403, trans('auth.errors.2fa_required'));
        }

        return $next($request);
    }
}
