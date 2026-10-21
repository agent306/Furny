<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionEntry;
use App\Support\Auth\SessionRegistry;
use App\Support\Features;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Props of `Customer/Account/Security` and `Admin/Account/Security` (10 §13.3, 11 §18, 14 §9). */
#[TypeScript]
final class AccountSecurityProps extends Data
{
    /**
     * @param  list<SessionData>  $sessions  The open devices, the one in use marked.
     */
    public function __construct(
        public bool $hasPassword,
        public bool $googleLinked,
        public bool $googleEnabled,
        public array $sessions,
    ) {}

    public static function fromUser(User $user, SessionRegistry $registry, string $currentSessionId): self
    {
        return new self(
            hasPassword: $user->hasPassword(),
            googleLinked: $user->google_id !== null,
            googleEnabled: Features::enabled('google_login'),
            sessions: array_map(
                static fn (SessionEntry $entry): SessionData => SessionData::fromEntry($entry),
                $registry->list($user, $currentSessionId),
            ),
        );
    }
}
