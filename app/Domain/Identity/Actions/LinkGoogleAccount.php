<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\ContactVerification;
use App\Domain\Identity\Support\GoogleAccountException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Ties a Google account to a user (13 §5.3 steps 4 and 6). `$googleId` is the Google subject and `$email` the
 * address Google verified, lower-cased. Both ways leave the address verified and the link audited as
 * `auth.google_linked` (`replaced`: it took the place of another Google account).
 *
 * Deviation from 13 §5.3 step 4 (ruled for task 28, log in 19): linking to an account whose address nobody had
 * verified would hand the account to Google's user while whoever registered it first (with a password of their
 * own) still holds the keys. So the link takes the account over: the password is cleared, the remember token is
 * rotated and the user's sessions are revoked (the one in use excepted), all audited with the reason
 * `google_link_unverified`.
 */
final class LinkGoogleAccount
{
    public function __construct(
        private readonly ContactVerification $contacts,
        private readonly RevokeSessions $revoke,
    ) {}

    /**
     * Sign-in with Google found the user by their address: Google vouches for the address, so the link is made
     * and the address counts as verified. Nobody is signed in yet, so every session of the user is revoked when
     * the address was unverified.
     */
    public function byEmail(User $user, string $googleId): void
    {
        $this->link($user, $googleId, setEmail: null, keepSessionId: null);
    }

    /**
     * The signed-in user links Google from their security page. Google must not be linked to anyone else, and its
     * address must be the user's own. A phone-only user has none, so Google's becomes theirs unless somebody else
     * holds it. `$currentSessionId` is the session in use, which stays signed in.
     *
     * @throws GoogleAccountException `google_in_use`, `google_email_mismatch` or `email_unavailable`
     */
    public function forSignedInUser(User $user, string $googleId, string $email, string $currentSessionId): void
    {
        if ($user->google_id === $googleId) {
            return;
        }

        if (User::withTrashed()->where('google_id', $googleId)->whereKeyNot($user->getKey())->exists()) {
            throw new GoogleAccountException('google_in_use');
        }

        if ($user->email !== null && $user->email !== $email) {
            throw new GoogleAccountException('google_email_mismatch');
        }

        if ($user->email === null && User::withTrashed()->where('email', $email)->whereKeyNot($user->getKey())->exists()) {
            throw new GoogleAccountException('email_unavailable');
        }

        $this->link($user, $googleId, setEmail: $user->email === null ? $email : null, keepSessionId: $currentSessionId);
    }

    private function link(User $user, string $googleId, ?string $setEmail, ?string $keepSessionId): void
    {
        $replaced = $user->google_id !== null && $user->google_id !== $googleId;
        // An address that was given to the account and never verified.
        $takeover = $setEmail === null && $user->email !== null && $user->email_verified_at === null;

        try {
            DB::transaction(function () use ($user, $googleId, $setEmail, $replaced, $takeover): void {
                $user->google_id = $googleId;

                if ($setEmail !== null) {
                    $user->email = $setEmail;
                    $user->email_verified_at = null;
                }

                if ($takeover) {
                    $user->password = null;
                    $user->remember_token = Str::random(60);
                }

                $user->save();

                // Google verified the address; the first verified contact of the user is announced from here.
                if ($user->email_verified_at === null) {
                    $this->contacts->markEmailVerified($user);
                }

                activity('security')
                    ->performedOn($user)
                    ->causedBy($user)
                    ->event('auth.google_linked')
                    ->withProperties(['replaced' => $replaced, ...($takeover ? ['reason' => RevokeSessions::REASON_GOOGLE_LINK_UNVERIFIED] : [])])
                    ->log('auth.google_linked');
            });
        } catch (UniqueConstraintViolationException) {
            // Another request took the Google account or the address between the check and the write.
            throw new GoogleAccountException($setEmail === null ? 'google_in_use' : 'email_unavailable');
        }

        // After the commit: the registry is Redis. The account is already Google's, so a failure here leaves the
        // earlier holder without a password, never with one.
        if ($takeover) {
            $keepSessionId === null
                ? $this->revoke->all($user, RevokeSessions::REASON_GOOGLE_LINK_UNVERIFIED)
                : $this->revoke->others($user, $keepSessionId, RevokeSessions::REASON_GOOGLE_LINK_UNVERIFIED);
        }
    }
}
