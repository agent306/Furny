<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * `2fa.enrolled` (13 §5.10): owners and admins without a confirmed TOTP can only reach the enrolment page and
 * the Fortify routes it needs. JSON clients get `403 {code: 'two_factor_required'}` instead of the redirect (14 §1.2). The
 * check reads the roles on every request, so a role change applies at once.
 */
final class EnsureTwoFactorEnrolled
{
    /** Route name patterns an unenrolled owner or admin may still use. */
    public const array EXEMPT = ['admin.security.two-factor', 'two-factor.*', 'password.confirm*', 'logout'];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            $user instanceof User
            && $user->requiresTwoFactor()
            && $user->two_factor_confirmed_at === null
            && ! $request->routeIs(...self::EXEMPT)
        ) {
            // Machines get the code (14 §1.2); an Inertia visit also accepts JSON, and is a page, so it is redirected.
            if (! $request->header('X-Inertia') && $request->expectsJson()) {
                return response()->json(['code' => 'two_factor_required'], 403);
            }

            Inertia::flash('error', trans_icu('auth.2fa_required'));

            return redirect()->route('admin.security.two-factor');
        }

        return $next($request);
    }
}
