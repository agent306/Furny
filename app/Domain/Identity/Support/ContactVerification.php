<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Where a user's email or phone becomes verified (13 §5.6). Every way of verifying a contact (the emailed link, a
 * password reset, a phone code, Google, an invitation) goes through here, so `ContactVerified` is dispatched in one
 * place, once per user: the verification that sets `first_contact_verified_at` announces it. Later verifications, of
 * the other contact, of the same one again, or of a new address after an email change, only set the timestamp.
 *
 * The event is dispatched after the surrounding transaction commits, and not at all when it rolls back.
 */
final class ContactVerification
{
    /** An address that is not there cannot be verified. */
    public function markEmailVerified(User $user): void
    {
        if ($user->email === null) {
            return;
        }

        $this->mark($user, 'email_verified_at');
    }

    public function markPhoneVerified(User $user): void
    {
        $this->mark($user, 'phone_verified_at');
    }

    /** @param  'email_verified_at'|'phone_verified_at'  $column */
    private function mark(User $user, string $column): void
    {
        DB::transaction(function () use ($user, $column): void {
            $now = now();

            $user->forceFill([$column => $now])->save();

            // One conditional UPDATE decides which verification is the first: of two that run at the same moment,
            // exactly one finds the column empty and affects the row.
            $first = DB::table('users')
                ->where('id', $user->getKey())
                ->whereNull('first_contact_verified_at')
                ->update(['first_contact_verified_at' => $now]) === 1;

            if (! $first) {
                return;
            }

            $user->setAttribute('first_contact_verified_at', $now);
            $user->syncOriginalAttribute('first_contact_verified_at');

            ContactVerified::dispatch($user);
        });
    }
}
