<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\ContactVerification;
use App\Domain\Identity\Support\GoogleAccountException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Ties a Google account to a user (13 §5.3 steps 4 and 6). `$googleId` is the Google subject and `$email` the
 * address Google verified, lower-cased. Both ways leave the address verified and the link audited as
 * `auth.google_linked`.
 */
final class LinkGoogleAccount
{
    public function __construct(private readonly ContactVerification $contacts) {}

    /**
     * Sign-in with Google found the user by their address: Google vouches for the address, so the link is made
     * and the address counts as verified.
     */
    public function byEmail(User $user, string $googleId): void
    {
        $this->link($user, $googleId, setEmail: null);
    }

    /**
     * The signed-in user links Google from their security page. Google must not be linked to anyone else, and its
     * address must be the user's own. A phone-only user has none, so Google's becomes theirs unless somebody else
     * holds it.
     *
     * @throws GoogleAccountException `google_in_use`, `google_email_mismatch` or `email_unavailable`
     */
    public function forSignedInUser(User $user, string $googleId, string $email): void
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

        $this->link($user, $googleId, setEmail: $user->email === null ? $email : null);
    }

    private function link(User $user, string $googleId, ?string $setEmail): void
    {
        try {
            DB::transaction(function () use ($user, $googleId, $setEmail): void {
                $user->google_id = $googleId;

                if ($setEmail !== null) {
                    $user->email = $setEmail;
                    $user->email_verified_at = null;
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
                    ->log('auth.google_linked');
            });
        } catch (UniqueConstraintViolationException) {
            // Another request took the Google account or the address between the check and the write.
            throw new GoogleAccountException($setEmail === null ? 'google_in_use' : 'email_unavailable');
        }
    }
}
