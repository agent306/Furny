<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use App\Support\Auth\ForcedLogout;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** `active` (13 §1): a deactivated or soft-deleted user is signed out and sent to login with `auth.inactive`. */
final class EnsureUserIsActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && (! $user->is_active || $user->trashed())) {
            return ForcedLogout::toLogin($request, 'inactive');
        }

        return $next($request);
    }
}
