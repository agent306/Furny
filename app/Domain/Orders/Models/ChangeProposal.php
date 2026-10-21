<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\ChangeProposalStatus;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\ChangeProposalFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * 02 §8.3. Staff write the explanation; the order, number, author, status, stamps and the
 * customer's comment are written by the proposal transitions T6–T8 (09 §2).
 *
 * @property string $id
 * @property string $order_id
 * @property int $number
 * @property ChangeProposalStatus $status
 * @property string|null $message
 * @property string $created_by
 * @property CarbonImmutable|null $sent_at
 * @property CarbonImmutable|null $resolved_at
 * @property CarbonImmutable|null $withdrawn_at
 * @property string|null $customer_comment
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['message'])]
final class ChangeProposal extends Model
{
    /** @use HasFactory<ChangeProposalFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'number' => 'integer',
            'status' => ChangeProposalStatus::class,
            'sent_at' => 'immutable_datetime',
            'resolved_at' => 'immutable_datetime',
            'withdrawn_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return HasMany<ChangeProposalItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(ChangeProposalItem::class);
    }

    protected static function newFactory(): ChangeProposalFactory
    {
        return ChangeProposalFactory::new();
    }
}
