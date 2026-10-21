<?php

declare(strict_types=1);

namespace App\Domain\Identity\Events;

use App\Domain\Identity\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Support\Str;

/**
 * A customer registered with email and password (13 §5.1). Shaped like the notifiable user events of 12 §3.4
 * (`eventId`, `eventKey`, `subjectUser`, `occurredAt`), which the notification phase routes by `eventKey()`.
 * Dispatched after the surrounding transaction commits.
 */
final class CustomerRegistered implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public const string EVENT_KEY = 'account.welcome';

    private readonly string $eventId;

    private readonly CarbonImmutable $occurredAt;

    public function __construct(public readonly User $user)
    {
        $this->eventId = (string) Str::ulid();
        $this->occurredAt = CarbonImmutable::now();
    }

    public function eventId(): string
    {
        return $this->eventId;
    }

    public function eventKey(): string
    {
        return self::EVENT_KEY;
    }

    public function subjectUser(): User
    {
        return $this->user;
    }

    public function occurredAt(): CarbonImmutable
    {
        return $this->occurredAt;
    }
}
