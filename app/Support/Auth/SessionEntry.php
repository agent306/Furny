<?php

declare(strict_types=1);

namespace App\Support\Auth;

use Carbon\CarbonImmutable;

/** One row of the device list (13 §6.3). Carries the `SessionKey`, never the session id. */
final readonly class SessionEntry
{
    public function __construct(
        public string $key,
        public string $uaSummary,
        public string $ipMasked,
        public CarbonImmutable $lastActiveAt,
        public bool $isCurrent,
        public string $method,
    ) {}
}
