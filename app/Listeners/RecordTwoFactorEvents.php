<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Domain\Identity\Models\User;
use Laravel\Fortify\Events\RecoveryCodeReplaced;
use Laravel\Fortify\Events\TwoFactorAuthenticationConfirmed;
use Laravel\Fortify\Events\TwoFactorAuthenticationDisabled;

/**
 * The audit of the second factor (13 §17, security log), from Fortify's events:
 *
 * - `auth.2fa_enabled`: a code from the authenticator confirmed the secret. Starting the setup is not enabling it: until
 *   the code is right nothing protects the account.
 * - `auth.2fa_disabled`: the user switched it off (only roles that may; owners and admins are refused earlier).
 * - `auth.recovery_code_used`: a recovery code signed the user in at the challenge (`RecoveryCodeReplaced`). The code is
 *   not recorded.
 *
 * The user is subject and causer of each, and there are no properties. A reset by someone else (`auth.2fa_reset`) is
 * written by `ResetTwoFactor`.
 */
final class RecordTwoFactorEvents
{
    private const array EVENTS = [
        TwoFactorAuthenticationConfirmed::class => 'auth.2fa_enabled',
        TwoFactorAuthenticationDisabled::class => 'auth.2fa_disabled',
        RecoveryCodeReplaced::class => 'auth.recovery_code_used',
    ];

    public function handle(TwoFactorAuthenticationConfirmed|TwoFactorAuthenticationDisabled|RecoveryCodeReplaced $event): void
    {
        $user = $event->user;

        if (! $user instanceof User) {
            return;
        }

        $name = self::EVENTS[$event::class];

        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event($name)
            ->log($name);
    }
}
