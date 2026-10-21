<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Support\Http\CodedValidationException;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Staff bring back a customer who asked to delete their account, within the 30 days and before the anonymisation
 * (13 §9.1). The sessions, push subscriptions and drafts of the deletion stay gone.
 */
final class RestoreDeletedAccount
{
    /**
     * @throws CodedValidationException `restore_window_passed`
     */
    public function handle(User $user, User $actor): void
    {
        if (! $user->isCustomer() || ! $user->trashed()) {
            throw new LogicException('Only a deleted customer account can be restored.');
        }

        if ($user->anonymised_at !== null || $user->deleted_at === null || $user->deleted_at->lte(now()->subDays(RequestAccountDeletion::GRACE_DAYS))) {
            throw CodedValidationException::make('restore_window_passed', trans_icu('account.errors.restore_window_passed'));
        }

        DB::transaction(function () use ($user, $actor): void {
            $user->restore();

            activity('security')
                ->performedOn($user)
                ->causedBy($actor)
                ->event('account.deletion_cancelled')
                ->withProperties(['via' => 'admin'])
                ->log('account.deletion_cancelled');
        });
    }
}
