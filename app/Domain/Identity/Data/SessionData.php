<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Support\Auth\SessionEntry;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** One device of the list on the security page (13 §6.3, 14 §19). `id` is the `SessionKey`, never the session id. */
#[TypeScript]
final class SessionData extends Data
{
    public function __construct(
        public string $id,
        public string $uaSummary,
        public string $ipMasked,
        public string $lastActiveAt,
        public bool $isCurrent,
        /** `password`, `otp`, `google` or `remember`. */
        public string $method,
    ) {}

    public static function fromEntry(SessionEntry $entry): self
    {
        return new self(
            id: $entry->key,
            uaSummary: $entry->uaSummary,
            ipMasked: $entry->ipMasked,
            lastActiveAt: $entry->lastActiveAt->toIso8601String(),
            isCurrent: $entry->isCurrent,
            method: $entry->method,
        );
    }
}
