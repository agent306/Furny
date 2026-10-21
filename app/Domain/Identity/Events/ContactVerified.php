<?php

declare(strict_types=1);

namespace App\Domain\Identity\Events;

use App\Domain\Identity\Models\User;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * The user's first verified contact exists (13 §5.6): `email_verified_at` or `phone_verified_at` became non-null
 * while both were null. Dispatched after the surrounding transaction commits, by `ContactVerification`; later
 * verifications do not dispatch it.
 */
final class ContactVerified implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(public readonly User $user) {}
}
