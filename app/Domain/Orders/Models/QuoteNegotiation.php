<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\NegotiationStatus;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\QuoteNegotiationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §8.7. The customer writes the counter price, the message and the per item comments; the quote,
 * order, customer and the staff answer are written by the negotiation actions (09 §6).
 *
 * @property string $id
 * @property string $quote_id
 * @property string $order_id
 * @property string $customer_id
 * @property int|null $proposed_total_minor
 * @property string $message
 * @property list<array{order_item_id: string, comment: string}> $item_comments
 * @property NegotiationStatus $status
 * @property string|null $answered_by
 * @property string|null $answer_message
 * @property CarbonImmutable|null $answered_at
 * @property string|null $resulting_quote_id
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['proposed_total_minor', 'message', 'item_comments'])]
final class QuoteNegotiation extends Model
{
    /** @use HasFactory<QuoteNegotiationFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'proposed_total_minor' => 'integer',
            'item_comments' => 'array',
            'status' => NegotiationStatus::class,
            'answered_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Quote, $this>
     */
    public function quote(): BelongsTo
    {
        return $this->belongsTo(Quote::class);
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
    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function answeredBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'answered_by');
    }

    /**
     * @return BelongsTo<Quote, $this>
     */
    public function resultingQuote(): BelongsTo
    {
        return $this->belongsTo(Quote::class, 'resulting_quote_id');
    }

    protected static function newFactory(): QuoteNegotiationFactory
    {
        return QuoteNegotiationFactory::new();
    }
}
