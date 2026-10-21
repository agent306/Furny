<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Domain\Identity\Actions\RevokeSessions;
use App\Domain\Identity\Models\User;
use App\Support\Auth\RememberCookie;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\UpdatesUserPasswords;

/**
 * Changes the password of the signed-in user (13 §2, 14 §3.1). The current password is asked for only when there
 * is one: a user who signed up by phone or Google has none and sets the first (13 §5.5). The user stays signed
 * in on this device; their other devices are signed out and their remember cookies stop working (13 §6.3).
 */
final class UpdateUserPassword implements UpdatesUserPasswords
{
    use PasswordValidationRules;

    public function __construct(private readonly RevokeSessions $revoke) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public function update(User $user, array $input): void
    {
        $validated = Validator::make($input, [
            ...($user->hasPassword() ? ['current_password' => $this->currentPasswordRules()] : []),
            'password' => $this->passwordRules(),
        ])->validate();

        $user->forceFill(['password' => $validated['password']])->save();

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('auth.password_changed')
            ->log('auth.password_changed');

        $request = request();

        $this->revoke->others($user, $request->session()->getId(), RevokeSessions::REASON_PASSWORD_CHANGED);

        // The remember token was rotated: this browser's remember cookie would stop working, and it carries the
        // hash of the old password.
        RememberCookie::renew($request, $user);
    }
}
