<?php

declare(strict_types=1);

namespace App\Domain\Ai\Models;

use App\Domain\Ai\Enums\CreditLedgerKind;
use App\Domain\Identity\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Ai\AiCreditLedgerEntryFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use LogicException;

/**
 * 02 §7.1: one row of the append-only credit ledger (balance = SUM(delta) per user). Rows are
 * written once by the credit actions (18 §9) and never updated, so any update throws and nothing is
 * mass-assignable.
 *
 * @property string $id
 * @property string $user_id
 * @property int $delta
 * @property CreditLedgerKind $kind
 * @property string|null $period
 * @property string|null $reference_type
 * @property string|null $reference_id
 * @property string|null $note
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 */
final class AiCreditLedgerEntry extends Model
{
    /** @use HasFactory<AiCreditLedgerEntryFactory> */
    use HasFactory, HasUlids;

    public const ?string UPDATED_AT = null;

    protected $table = 'ai_credit_ledger';

    protected static function booted(): void
    {
        self::updating(static function (self $entry): never {
            throw new LogicException("Ledger entry {$entry->getKey()} is immutable and cannot be updated.");
        });
    }

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'delta' => 'integer',
            'kind' => CreditLedgerKind::class,
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The admin who made a manual grant or revoke.
     *
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The record the entry is about: a BlueprintImport for reservations, consumption and refunds.
     *
     * @return MorphTo<Model, $this>
     */
    public function reference(): MorphTo
    {
        return $this->morphTo();
    }

    protected static function newFactory(): AiCreditLedgerEntryFactory
    {
        return AiCreditLedgerEntryFactory::new();
    }
}
