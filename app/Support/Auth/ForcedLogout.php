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
 *
 * A revoked session ends only itself: `logout()` would also cycle the `remember_token` and so sign the user out of
 * every device that holds a remember cookie, which is what revoking one device must not do.
 */
final class ForcedLogout
{
    /** @param  string  $reason  `inactive`, `session_expired` or `session_revoked`: the `auth.{reason}` message and the JSON `code` */
    public static function toLogin(Request $request, string $reason): RedirectResponse|JsonResponse
    {
        $guard = Auth::guard();

        if ($reason === 'session_revoked') {
            $guard->logoutCurrentDevice();
        } else {
            $guard->logout();
        }

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        if (ErrorPage::wantsMachineResponse($request)) {
            return response()->json(['code' => $reason], 401);
        }

        // After the invalidation, so the message and the flag land in the new session. The history of the browser is
        // cleared as for any other end of a session (13 §12.4).
        Inertia::clearHistory();
        Inertia::flash('error', trans_icu('auth.'.$reason));

        return redirect()->route('login');
    }
}
