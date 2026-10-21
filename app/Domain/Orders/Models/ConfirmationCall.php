<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\CallOutcome;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\ConfirmationCallFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §8.8. Staff log what the call said; the order and the caller are written by the log-call action.
 *
 * @property string $id
 * @property string $order_id
 * @property string $staff_id
 * @property CarbonImmutable $called_at
 * @property string $phone_e164
 * @property CallOutcome $outcome
 * @property string|null $notes
 * @property CarbonImmutable|null $callback_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['called_at', 'phone_e164', 'outcome', 'notes', 'callback_at'])]
final class ConfirmationCall extends Model
{
    /** @use HasFactory<ConfirmationCallFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'called_at' => 'immutable_datetime',
            'outcome' => CallOutcome::class,
            'callback_at' => 'immutable_datetime',
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
    public function staff(): BelongsTo
    {
        return $this->belongsTo(User::class, 'staff_id');
    }

    protected static function newFactory(): ConfirmationCallFactory
    {
        return ConfirmationCallFactory::new();
    }
}
