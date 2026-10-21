<?php

declare(strict_types=1);

namespace App\Domain\Identity\Support;

use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Where a user's email or phone becomes verified (13 §5.6). Every way of verifying a contact (the emailed link, a
 * password reset, a phone code, Google, an invitation) goes through here, so `ContactVerified` is dispatched in one
 * place: when the user had no verified contact before, and so gets their first one. Later verifications, of the
 * other contact or of the same one again, only set the timestamp.
 *
 * The event is dispatched after the surrounding transaction commits, and not at all when it rolls back.
 */
final class ContactVerification
{
    public function markEmailVerified(User $user): void
    {
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
            // The row is locked while both timestamps are read, so two contacts verified at the same moment
            // cannot both count as the first.
            $stored = User::query()->whereKey($user->getKey())->lockForUpdate()->first();
            $first = $stored !== null && $stored->email_verified_at === null && $stored->phone_verified_at === null;

            $user->forceFill([$column => now()])->save();

            if ($first) {
                ContactVerified::dispatch($user);
            }
        });
    }
}
