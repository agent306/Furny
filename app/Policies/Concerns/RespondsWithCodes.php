<?php

declare(strict_types=1);

namespace App\Policies\Concerns;

use App\Domain\Identity\Models\User;
use Illuminate\Auth\Access\Response;

/** The denial statuses of 13 §8: 404 for strangers, 403 for everybody else. */
trait RespondsWithCodes
{
    /**
     * Allow, or deny the way 13 §8 prescribes: a customer who does not own the record gets 404 so the
     * record's existence is not revealed; staff and the record's own customer get 403.
     */
    protected function allowOrDeny(bool $allowed, User $user, bool $ownsRecord = false): Response
    {
        return match (true) {
            $allowed => Response::allow(),
            $user->isCustomer() && ! $ownsRecord => Response::denyAsNotFound(),
            default => Response::denyWithStatus(403),
        };
    }
}
