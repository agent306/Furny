<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\ContactVerification;
use App\Domain\Identity\Support\PhoneAccountOutcome;
use App\Support\Settings\Settings;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Decides what a phone number whose owner has just proved it with a code leads to (13 §5.2 step 2). The same for a
 * sign-in and a sign-up: whoever owns the number gets their account, and a number nobody has gets one made.
 *
 * - an account pending deletion, a staff account (staff sign in with their email) and a deactivated account are
 *   refused;
 * - an account is signed in, and its number counts as verified from now on if it did not already;
 * - a number with no account is refused while registration is closed; with a name an account is created, without one
 *   the caller has to ask for it.
 */
final class ResolvePhoneAccount
{
    public function __construct(
        private readonly Settings $settings,
        private readonly RegisterCustomer $registrations,
        private readonly ContactVerification $contacts,
    ) {}

    public function handle(string $e164, ?string $name): PhoneAccountOutcome
    {
        $user = User::withTrashed()->where('phone_e164', $e164)->first();

        if ($user !== null) {
            return $this->existing($user);
        }

        if (! $this->settings->auth()->allowCustomerRegistration) {
            return PhoneAccountOutcome::refused('auth.registration_closed');
        }

        if ($name === null || trim($name) === '') {
            return PhoneAccountOutcome::nameNeeded();
        }

        try {
            return PhoneAccountOutcome::account($this->registrations->fromPhone($e164, $name));
        } catch (UniqueConstraintViolationException) {
            // A sign-up with the same number finished a moment ago: its account is the one.
            $user = User::withTrashed()->where('phone_e164', $e164)->first();

            return $user === null ? PhoneAccountOutcome::refused('auth.errors.otp_failed') : $this->existing($user);
        }
    }

    private function existing(User $user): PhoneAccountOutcome
    {
        if ($user->trashed()) {
            return PhoneAccountOutcome::refused('auth.errors.account_pending_deletion');
        }

        if ($user->isStaff()) {
            return PhoneAccountOutcome::refused('auth.errors.staff_use_email');
        }

        if (! $user->is_active) {
            return PhoneAccountOutcome::refused('auth.inactive');
        }

        if ($user->phone_verified_at === null) {
            $this->contacts->markPhoneVerified($user);
        }

        return PhoneAccountOutcome::account($user);
    }
}
