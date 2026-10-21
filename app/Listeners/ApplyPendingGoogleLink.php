<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Domain\Identity\Actions\LinkGoogleAccount;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\GoogleAccountException;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\SessionGuard;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * Finishes a Google sign-in that waited for the two-factor challenge (13 §5.3 step 5).
 *
 * Signing in with Google by the address of an account nobody verified links Google to it and takes it over: the
 * password goes, the remember token is rotated and the sessions are revoked (`LinkGoogleAccount`). For staff with a
 * confirmed second factor none of it may happen on the strength of Google alone, or whoever owns the Google account
 * for that address could lock the staff member out without the authenticator. So the callback does not link: it
 * leaves `{user, googleId}` under `auth.pending_google_link` and hands the visitor to the challenge, and the link is
 * made here, when the challenge has signed that very user in. A challenge that is failed or abandoned leaves the
 * account as it was; a password sign-in forgets the pending link (`AuthenticateUser`).
 *
 * It runs on `Login`, before the request that signed the user in registers its session, so the revocation of the
 * user's other sessions leaves the one just opened.
 */
final class ApplyPendingGoogleLink
{
    /** Session key of the link that waits for the challenge: `{user: id, googleId: Google subject}`. */
    public const string KEY = 'auth.pending_google_link';

    public function __construct(private readonly LinkGoogleAccount $links) {}

    public function handle(Login $event): void
    {
        $user = $event->user;
        $request = request();

        if (! $user instanceof User || ! $request->hasSession()) {
            return;
        }

        $pending = $request->session()->pull(self::KEY);
        $guard = Auth::guard($event->guard);

        if (
            ! is_array($pending)
            || ($guard instanceof SessionGuard && $guard->viaRemember())
            || ($pending['user'] ?? null) !== $user->getKey()
            || ! is_string($pending['googleId'] ?? null)
        ) {
            return;
        }

        try {
            $this->links->byEmail($user, $pending['googleId']);
        } catch (GoogleAccountException $exception) {
            // The Google account was linked elsewhere meanwhile. The visitor passed the challenge, so they are in.
            Log::warning('auth.google_link_deferred_failed', ['reason' => $exception->reason]);
        }
    }
}
