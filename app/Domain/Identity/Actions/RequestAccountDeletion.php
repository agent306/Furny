<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Contracts\AccountDeletionStep;
use App\Domain\Identity\Models\User;
use App\Notifications\Account\DeletionScheduled;
use App\Support\Http\CodedValidationException;
use Illuminate\Container\Attributes\Tag;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * A customer asks to delete their account (13 §9.1). Refused while an order is Active; otherwise, in one transaction, the
 * registered steps run (drafts deleted, imports and submitted orders cancelled), the "scheduled" mail goes out, the user is
 * soft-deleted and their push subscriptions go. Then every session is destroyed and the remember token rotated: Redis
 * cannot be rolled back, so that comes after the commit. `users:anonymise-deleted` finishes the job 30 days later.
 */
final class RequestAccountDeletion
{
    /** Days between the request and the anonymisation (13 §9.2); the window in which staff can restore the account. */
    public const int GRACE_DAYS = 30;

    /** @param  iterable<AccountDeletionStep>  $steps */
    public function __construct(
        private readonly RevokeSessions $sessions,
        #[Tag('account.deletion_steps')] private readonly iterable $steps,
    ) {}

    /**
     * @throws CodedValidationException `confirmation`, `active_orders`
     */
    public function handle(User $user, string $confirmation): void
    {
        if (! $user->isCustomer()) {
            throw new LogicException('Staff accounts are deactivated, not deleted (13 §9.1).');
        }

        $this->guardConfirmation($confirmation);
        $this->guardActiveOrders($user);

        DB::transaction(function () use ($user): void {
            foreach ($this->steps as $step) {
                $step->handle($user);
            }

            // Before the soft delete: the queue restores the user, and the mail says when the account is gone for good.
            $user->notify(new DeletionScheduled(now()->addDays(self::GRACE_DAYS)->toImmutable()));

            $user->delete();
            $user->pushSubscriptions()->delete();

            activity('security')
                ->performedOn($user)
                ->causedBy($user)
                ->event('account.deletion_requested')
                ->withProperties(['via' => 'web'])
                ->log('account.deletion_requested');
        });

        $this->sessions->all($user, RevokeSessions::REASON_ACCOUNT_DELETION);
    }

    private function guardConfirmation(string $confirmation): void
    {
        $word = trans_icu('account.delete_word');

        if (mb_strtolower(trim($confirmation)) !== mb_strtolower($word)) {
            throw CodedValidationException::make('confirmation', trans_icu('account.errors.confirmation', ['word' => $word]), 'confirmation');
        }
    }

    private function guardActiveOrders(User $user): void
    {
        $orders = $user->activeOrders()->orderBy('created_at')->get(['id', 'number']);

        if ($orders->isEmpty()) {
            return;
        }

        throw CodedValidationException::make('active_orders', trans_icu('account.errors.active_orders', ['numbers' => $orders->pluck('number')->implode(', ')]))
            ->withContext(['orders' => $orders->map(static fn ($order): array => ['id' => $order->id, 'number' => $order->number])->all()]);
    }
}
