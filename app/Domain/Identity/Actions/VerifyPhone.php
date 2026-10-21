<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpException;
use App\Domain\Identity\Support\ContactVerification;
use App\Support\Privacy\Mask;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Makes a number the signed-in user's own, once they have proved it with a code (13 §5.7): it is stored as their phone,
 * verified now, and the change is audited as `account.phone_verified` with the old and the new number masked. Staff
 * may add a phone the same way (for WhatsApp notifications). The user's first verified contact is announced by
 * `ContactVerification`.
 *
 * Whether somebody else has the number is only answered here, after the code, so that a number cannot be probed
 * without owning it: another user, soft-deleted ones included, makes it `phone_unavailable`, with no further detail.
 */
final class VerifyPhone
{
    public function __construct(private readonly ContactVerification $contacts) {}

    /** @throws OtpException `phone_unavailable` (422) */
    public function handle(User $user, string $e164): void
    {
        $previous = $user->phone_e164;

        try {
            DB::transaction(function () use ($user, $e164, $previous): void {
                if (User::withTrashed()->where('phone_e164', $e164)->whereKeyNot($user->getKey())->exists()) {
                    throw new OtpException('phone_unavailable', 422);
                }

                $user->phone_e164 = $e164;
                $this->contacts->markPhoneVerified($user);

                activity('security')
                    ->performedOn($user)
                    ->causedBy($user)
                    ->event('account.phone_verified')
                    ->withProperties([
                        'from' => $previous === null ? null : Mask::phone($previous),
                        'to' => Mask::phone($e164),
                    ])
                    ->log('account.phone_verified');
            });
        } catch (UniqueConstraintViolationException) {
            // Somebody took the number between the check and the write.
            $user->phone_e164 = $previous;

            throw new OtpException('phone_unavailable', 422);
        }
    }
}
