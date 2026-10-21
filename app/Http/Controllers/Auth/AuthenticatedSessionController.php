<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Listeners\RecordLogout;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Fortify\Contracts\LogoutResponse;
use Laravel\Fortify\Http\Controllers\AuthenticatedSessionController as FortifyAuthenticatedSessionController;

/**
 * Fortify's session controller with a logout that ends this device only (13 §6.3). Fortify's own `logout()` cycles
 * the `remember_token`, which would end the remember cookie of every other device. Bound over Fortify's class in
 * `FortifyServiceProvider`, so its routes, middleware and login pipeline stay as they are.
 */
final class AuthenticatedSessionController extends FortifyAuthenticatedSessionController
{
    public function destroy(Request $request): LogoutResponse
    {
        // Tells `RecordLogout` that the user did this themselves, so it is audited as `auth.logout`.
        $request->attributes->set(RecordLogout::USER_INITIATED, true);

        // Forgets this device's remember cookie; the token stays, and so do the other devices.
        Auth::guard((string) config('fortify.guard'))->logoutCurrentDevice();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return app(LogoutResponse::class);
    }
}
