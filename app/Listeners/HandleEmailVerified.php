<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Domain\Identity\Models\User;
use App\Support\Privacy\Mask;
use Illuminate\Auth\Events\Verified;

/**
 * An email address was verified by its link (13 §5.6): the audit entry `account.email_verified`. The first verified
 * contact of the user is announced by `ContactVerification`, which verified the address, not here.
 */
final class HandleEmailVerified
{
    public function handle(Verified $event): void
    {
        $user = $event->user;

        if (! $user instanceof User) {
            return;
        }

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('account.email_verified')
            ->withProperties(['email' => Mask::email((string) $user->email)])
            ->log('account.email_verified');
    }
}
