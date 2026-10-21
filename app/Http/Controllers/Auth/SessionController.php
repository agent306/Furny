<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;

/** Remote sign-out from the device list (13 §6.3). */
final class SessionController extends Controller
{
    public function __construct(private readonly SessionRegistry $registry) {}

    /** Signs out one device. Signing out the device in use ends this session, and the user lands on login. */
    public function destroy(Request $request, string $sessionKey): RedirectResponse
    {
        $user = $this->user($request);

        if (! $this->registry->destroy($user, $sessionKey)) {
            abort(404);
        }

        $this->audit($user, 1, 'signed_out_device');

        if (! hash_equals(SessionKey::for($request->session()->getId()), $sessionKey)) {
            Inertia::flash('success', trans_icu('account.toasts.session_revoked'));

            return back();
        }

        Auth::guard()->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        // After the invalidation, so they land in the new session and reach the login page the user is sent to.
        Inertia::clearHistory();

        return redirect()->route('login');
    }

    /** Signs out every other device (`recent.auth`). */
    public function destroyOthers(Request $request): RedirectResponse
    {
        $user = $this->user($request);
        $remembered = Auth::guard('web')->viaRemember();

        $count = $this->registry->destroyOthers($user, $request->session()->getId());

        // The remember token was rotated: a browser that came in on the remember cookie needs the new one.
        if ($remembered) {
            Auth::login($user, true);
        }

        $this->audit($user, $count, 'signed_out_others');

        Inertia::clearHistory();
        Inertia::flash('success', trans_icu('account.toasts.sessions_revoked', ['count' => $count]));

        return back();
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        abort_unless($user instanceof User, 403);

        return $user;
    }

    private function audit(User $user, int $count, string $reason): void
    {
        if ($count === 0) {
            return;
        }

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('auth.sessions_revoked')
            ->withProperties(['count' => $count, 'reason' => $reason])
            ->log('auth.sessions_revoked');
    }
}
