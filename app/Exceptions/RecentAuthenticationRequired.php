<?php

declare(strict_types=1);

namespace App\Exceptions;

use App\Domain\Identity\Models\User;
use App\Support\Auth\IntendedRedirect;
use App\Support\Http\ErrorPage;
use Exception;
use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Thrown by `recent.auth` (13 §6.4). Machines get `403 {code: 'recent_auth_required'}`. Browsers and Inertia
 * visits are sent to confirm the password (or, without a password, to re-authenticate by phone OTP or
 * Google) and come back to the page they wanted. The page to come back to is stored only when it is on this
 * site (13 §12.7): the URL of a GET, else the Referer as a relative path.
 */
final class RecentAuthenticationRequired extends Exception implements ShouldntReport
{
    public function render(Request $request): Response
    {
        if (ErrorPage::wantsMachineResponse($request)) {
            return response()->json(['code' => 'recent_auth_required'], 403);
        }

        $intended = $request->isMethod('GET') ? $request->fullUrl() : $this->refererPath($request);

        if ($intended !== null && $request->hasSession()) {
            $request->session()->put(IntendedRedirect::SESSION_KEY, $intended);
        }

        $user = $request->user();

        return redirect()->to(route($user instanceof User && $user->hasPassword() ? 'password.confirm' : 'auth.reauthenticate'));
    }

    /** The Referer as a path of this site. A browser sends an absolute URL; anything else is not a Referer. */
    private function refererPath(Request $request): ?string
    {
        $referer = $request->headers->get('Referer');

        return $referer === null || str_starts_with($referer, '/') ? null : IntendedRedirect::sameSitePath($request, $referer);
    }
}
