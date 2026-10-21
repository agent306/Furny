<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `customer` / `staff` (13 §1). Staff on a customer page go to the admin dashboard; a customer on an admin
 * page gets 403 (rendered as the Error page).
 */
final class EnsureUserType
{
    public function handle(Request $request, Closure $next, string $type): Response
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        $required = UserType::from($type);

        return match (true) {
            $user->type === $required => $next($request),
            $required === UserType::Customer => redirect()->route('admin.dashboard'),
            default => abort(403),
        };
    }
}
