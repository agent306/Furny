<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Identity\Actions\AnonymiseUser;
use App\Domain\Identity\Actions\RequestAccountDeletion;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use Illuminate\Console\Command;
use Throwable;

/**
 * Anonymises the customers whose deletion request is 30 days old (13 §9.2). One transaction per customer, so one that
 * fails is reported and the rest still go; the run then fails. Scheduled daily at 03:15 (01 §7, Task 39).
 */
final class AnonymiseDeletedUsers extends Command
{
    protected $signature = 'users:anonymise-deleted';

    protected $description = 'Anonymise the customers who asked to delete their account 30 days ago or more';

    public function handle(AnonymiseUser $anonymise): int
    {
        $done = 0;
        $failed = 0;

        User::onlyTrashed()
            ->where('type', UserType::Customer->value)
            ->whereNull('anonymised_at')
            ->where('deleted_at', '<=', now()->subDays(RequestAccountDeletion::GRACE_DAYS))
            ->chunkById(100, function ($users) use ($anonymise, &$done, &$failed): void {
                foreach ($users as $user) {
                    try {
                        $anonymise->handle($user, AnonymiseUser::VIA_SCHEDULER);
                        $done++;
                    } catch (Throwable $exception) {
                        // The id only: the message of a database error can carry the row.
                        report($exception);
                        $this->error('Could not anonymise customer '.$user->getKey().'.');
                        $failed++;
                    }
                }
            });

        $this->info("Anonymised {$done} customers.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
