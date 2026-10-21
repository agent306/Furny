<?php

declare(strict_types=1);

namespace App\Exceptions;

use App\Domain\Identity\Models\User;
use App\Support\Http\ErrorPage;
use Exception;
use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Thrown by `recent.auth` (13 §6.4). Machines get `403 {code: 'recent_auth_required'}`. Browsers and Inertia
 * visits are sent to confirm the password (or, without a password, to re-authenticate by phone OTP or
 * Google) and come back to the page they wanted: the redirect stores the intended URL.
 */
final class RecentAuthenticationRequired extends Exception implements ShouldntReport
{
    public function render(Request $request): Response
    {
        if (! $request->header('X-Inertia') && ($request->expectsJson() || $request->is(...ErrorPage::MACHINE_PATHS))) {
            return response()->json(['code' => 'recent_auth_required'], 403);
        }

        $user = $request->user();

        return redirect()->guest(route($user instanceof User && $user->hasPassword() ? 'password.confirm' : 'auth.reauthenticate'));
    }
}
