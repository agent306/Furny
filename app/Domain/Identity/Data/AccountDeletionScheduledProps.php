<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Props of `Auth/AccountDeletionScheduled` (13 §9.1, 14 §2). */
#[TypeScript]
final class AccountDeletionScheduledProps extends Data
{
    /**
     * @param  string|null  $anonymiseOn  `YYYY-MM-DD`, from a one-time flash; null when the page is opened directly
     */
    public function __construct(
        public ?string $anonymiseOn,
        public string $supportEmail,
    ) {}
}
