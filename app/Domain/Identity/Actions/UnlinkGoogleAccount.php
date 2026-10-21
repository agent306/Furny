<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Removes the Google link (13 §5.3). Only while another way to sign in remains (13 §5.8): a password together with
 * an email to sign in with, or a verified phone.
 */
final class UnlinkGoogleAccount
{
    /** @throws ValidationException `google`: `auth.errors.last_login_method` when Google is the only way in */
    public function handle(User $user): void
    {
        if ($user->google_id === null) {
            return;
        }

        if (! ($user->hasPassword() && $user->email !== null) && ($user->phone_e164 === null || $user->phone_verified_at === null)) {
            throw ValidationException::withMessages(['google' => __('auth.errors.last_login_method')]);
        }

        DB::transaction(function () use ($user): void {
            $user->google_id = null;
            $user->save();

            activity('security')
                ->performedOn($user)
                ->causedBy($user)
                ->event('auth.google_unlinked')
                ->log('auth.google_unlinked');
        });
    }
}
