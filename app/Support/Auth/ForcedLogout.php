<?php

declare(strict_types=1);

namespace App\Support\Auth;

use App\Support\Http\ErrorPage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;

/**
 * Ends the session of a user the app no longer lets in. Browsers and Inertia visits go to login with the reason as
 * the error flash; JSON clients and machine paths get `401 {code}`.
 */
final class ForcedLogout
{
    /** @param  string  $reason  `inactive` or `session_expired`: the `auth.{reason}` message and the JSON `code` */
    public static function toLogin(Request $request, string $reason): RedirectResponse|JsonResponse
    {
        Auth::guard()->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        if (ErrorPage::wantsMachineResponse($request)) {
            return response()->json(['code' => $reason], 401);
        }

        // After the invalidation, so the message lands in the new session and is shown once on the login page.
        Inertia::flash('error', trans_icu('auth.'.$reason));

        return redirect()->route('login');
    }
}
