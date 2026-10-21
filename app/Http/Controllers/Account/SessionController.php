<?php

declare(strict_types=1);

namespace App\Http\Controllers\Account;

use App\Domain\Identity\Actions\RevokeSessions;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Support\Auth\RememberCookie;
use App\Support\Auth\SessionKey;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;

/** Remote sign-out from the device list (13 §6.3). */
final class SessionController extends Controller
{
    /** Signs out one device. Signing out the device in use ends this session, and the user lands on login. */
    public function destroy(Request $request, RevokeSessions $revoke, string $sessionKey): RedirectResponse
    {
        $isCurrent = hash_equals(SessionKey::for($request->session()->getId()), $sessionKey);

        if ($revoke->device($this->user($request), $sessionKey, $isCurrent) === null) {
            abort(404);
        }

        if ($isCurrent) {
            return redirect()->route('login');
        }

        Inertia::flash('success', trans_icu('account.toasts.session_revoked'));

        return back();
    }

    /** Signs out every other device (`recent.auth`). */
    public function destroyOthers(Request $request, RevokeSessions $revoke): RedirectResponse
    {
        $user = $this->user($request);

        $count = $revoke->others($user, $request->session()->getId());

        // The remember token was rotated: this browser's remember cookie holds the old one and would stop working.
        RememberCookie::renew($request, $user);

        Inertia::flash('success', trans_icu('account.toasts.sessions_revoked', ['count' => $count]));

        return back();
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        abort_unless($user instanceof User, 403);

        return $user;
    }
}
