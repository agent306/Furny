<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\ProfileValidationRules;
use App\Domain\Identity\Models\User;
use App\Support\Privacy\Mask;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\UpdatesUserProfileInformation;

/**
 * The profile form (13 §5.8, 14 §3.1): name, email and, for customers, the marketing choice. A changed email
 * starts unverified and gets a verification link; `recent.auth` for that change is decided before this runs
 * (`FortifyRouteGuards`). An email that is not sent is not touched. An email that is cleared must not leave the
 * user without a way to sign in.
 */
final class UpdateUserProfileInformation implements UpdatesUserProfileInformation
{
    use ProfileValidationRules;

    /**
     * @param  array<string, mixed>  $input
     */
    public function update(User $user, array $input): void
    {
        $sendsEmail = array_key_exists('email', $input);
        $input = $this->normalise($input);

        $validated = Validator::make($input, [
            'name' => $this->nameRules(),
            'email' => $this->emailRules($user->getKey(), required: $user->isStaff()),
            'marketing_opt_in' => ['boolean'],
        ], [
            'email.unique' => __('auth.email_unavailable'),
        ])->validate();

        $email = $sendsEmail ? $this->emailOf($validated) : $user->email;
        $changesEmail = $email !== $user->email;

        if ($changesEmail && $email === null && ! $this->canSignInWithoutEmail($user)) {
            throw ValidationException::withMessages(['email' => __('auth.errors.last_login_method')]);
        }

        $from = $user->email;

        DB::transaction(function () use ($user, $validated, $email, $changesEmail, $from): void {
            $user->name = $validated['name'];

            // Staff have no marketing choice: they are not marketed to.
            if ($user->isCustomer()) {
                $user->marketing_opt_in = (bool) $validated['marketing_opt_in'];
            }

            if ($changesEmail) {
                $user->email = $email;
                $user->email_verified_at = null;
            }

            $user->save();

            if ($changesEmail) {
                activity('security')
                    ->performedOn($user)
                    ->causedBy($user)
                    ->event('account.email_changed')
                    ->withProperties([
                        'from' => $from === null ? null : Mask::email($from),
                        'to' => $email === null ? null : Mask::email($email),
                    ])
                    ->log('account.email_changed');
            }
        });

        if ($changesEmail) {
            // Nothing to send when the email was cleared: the method does nothing without an address.
            $user->sendEmailVerificationNotification();
        }
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function normalise(array $input): array
    {
        if (is_string($input['name'] ?? null)) {
            $input['name'] = trim($input['name']);
        }

        if (is_string($input['email'] ?? null)) {
            $input['email'] = mb_strtolower(trim($input['email']));
        }

        // A checkbox that is not ticked is not sent.
        $input['marketing_opt_in'] = filter_var($input['marketing_opt_in'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return $input;
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function emailOf(array $validated): ?string
    {
        $email = $validated['email'] ?? null;

        return is_string($email) && $email !== '' ? $email : null;
    }

    /**
     * A verified phone or a linked Google account still signs the user in once the email is gone (13 §5.8). The user
     * also needs a phone number on record: the row must keep an email or a phone number (02 §1.1), and an account
     * with Google and no phone has nothing to keep once the email goes.
     */
    private function canSignInWithoutEmail(User $user): bool
    {
        return $user->phone_e164 !== null && ($user->phone_verified_at !== null || $user->google_id !== null);
    }
}
