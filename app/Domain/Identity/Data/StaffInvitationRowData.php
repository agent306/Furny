<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Models\StaffInvitation;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** A row of the invitations table of the staff page (11 §7): pending, or expired within the last 30 days. */
#[TypeScript]
final class StaffInvitationRowData extends Data
{
    public function __construct(
        public string $id,
        public string $email,
        public string $name,
        public string $role,
        public ?UserRefData $invitedBy,
        public string $expiresAt,
        public bool $expired,
        public string $createdAt,
    ) {}

    public static function fromInvitation(StaffInvitation $invitation): self
    {
        return new self(
            id: $invitation->id,
            email: $invitation->email,
            name: $invitation->name,
            role: $invitation->role->value,
            invitedBy: $invitation->invitedBy === null ? null : UserRefData::fromUser($invitation->invitedBy),
            expiresAt: $invitation->expires_at->toIso8601String(),
            expired: $invitation->isExpired(),
            createdAt: (string) $invitation->created_at?->toIso8601String(),
        );
    }
}
