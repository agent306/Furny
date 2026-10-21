<?php

declare(strict_types=1);

namespace App\Support\Auth;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;

/** Ends the session of a user the app no longer lets in and sends them to login with the reason as the error flash. */
final class ForcedLogout
{
    /** @param  string  $messageKey  a translation key such as `auth.inactive` */
    public static function toLogin(Request $request, string $messageKey): RedirectResponse
    {
        Auth::guard()->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        // After the invalidation, so the message lands in the new session and is shown once on the login page.
        Inertia::flash('error', trans_icu($messageKey));

        return redirect()->route('login');
    }
}
