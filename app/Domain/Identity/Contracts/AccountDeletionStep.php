<?php

declare(strict_types=1);

namespace App\Domain\Identity\Contracts;

use App\Domain\Identity\Models\User;

/**
 * A piece of work that must happen when a customer asks to delete their account (13 §9.1 step 2.1-2.2): drafts are
 * deleted, submitted orders cancelled, blueprint imports cancelled. Each domain registers its own under the container
 * tag `account.deletion_steps` (AppServiceProvider); `RequestAccountDeletion` runs them in the deletion's transaction,
 * while the account is still active, and a step that throws stops the deletion.
 */
interface AccountDeletionStep
{
    public function handle(User $user): void;
}
