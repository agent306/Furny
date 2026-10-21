<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Identity\Enums\StaffRole;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Identity\StaffInvitationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §1.5. Rows are never deleted (audit, 13 §5.9).
 *
 * @property string $id
 * @property string $email
 * @property string $name
 * @property StaffRole $role
 * @property string|null $invited_by
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $accepted_at
 * @property CarbonImmutable|null $revoked_at
 * @property string|null $user_id
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['email', 'name', 'role', 'invited_by', 'expires_at', 'accepted_at', 'revoked_at', 'user_id'])]
final class StaffInvitation extends Model
{
    /** @use HasFactory<StaffInvitationFactory> */
    use HasFactory, HasUlids;

    /** How long an invitation, and its signed link, can be accepted: from sending, and again from every resend (13 §5.9). */
    public const int VALID_FOR_HOURS = 72;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => StaffRole::class,
            'expires_at' => 'immutable_datetime',
            'accepted_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return Attribute<string, string>
     */
    protected function email(): Attribute
    {
        return Attribute::set(static fn (string $value): string => mb_strtolower(trim($value)));
    }

    /** Not accepted and not revoked: it still counts for the "one open invitation per address" rule, expired or not. */
    public function isOpen(): bool
    {
        return $this->accepted_at === null && $this->revoked_at === null;
    }

    public function isExpired(): bool
    {
        return ! $this->expires_at->isFuture();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    protected static function newFactory(): StaffInvitationFactory
    {
        return StaffInvitationFactory::new();
    }
}
