<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Domain\Identity\Actions\RevokeSessions;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\ContactVerification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\ResetsUserPasswords;

/**
 * Sets the new password after the broker accepted the reset token (13 §5.5). Opening the emailed link proves the
 * address is the user's, so an unverified email is verified. Every session of the user ends, the remember token
 * is rotated, and the reset is audited. Fortify then fires `PasswordReset` and the response sends the user to the
 * login page.
 */
final class ResetUserPassword implements ResetsUserPasswords
{
    use PasswordValidationRules;

    public function __construct(
        private readonly ContactVerification $contacts,
        private readonly RevokeSessions $revoke,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public function reset(User $user, array $input): void
    {
        $validated = Validator::make($input, [
            'password' => $this->passwordRules(),
        ])->validate();

        DB::transaction(function () use ($user, $validated): void {
            $user->forceFill(['password' => $validated['password']])->save();

            if ($user->email_verified_at === null) {
                $this->contacts->markEmailVerified($user);
            }
        });

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('auth.password_reset')
            ->log('auth.password_reset');

        $this->revoke->all($user, RevokeSessions::REASON_PASSWORD_RESET);
    }
}
