<?php

declare(strict_types=1);

namespace App\Domain\Messaging\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Messaging\MessageReadFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 02 §9.2: how far a user has read an order's thread. The table is keyed by (`order_id`, `user_id`),
 * which Eloquent cannot express, so the model has no single key: saving, deleting, `fresh()` and
 * `refresh()` address the row by both columns, and rows are found with `where` on those two columns,
 * never `find()`. The order and user are set by the read action, so only the marker is
 * mass-assignable.
 *
 * @property string $order_id
 * @property string $user_id
 * @property CarbonImmutable $last_read_at
 * @property string|null $last_read_message_id
 */
#[Fillable(['last_read_at', 'last_read_message_id'])]
final class MessageRead extends Model
{
    /** @use HasFactory<MessageReadFactory> */
    use HasFactory;

    protected $primaryKey = null;

    public $incrementing = false;

    public $timestamps = false;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'last_read_at' => 'immutable_datetime',
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
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Deletes the row of this order and user. `Model::delete()` refuses a model without a primary key.
     */
    public function delete(): bool
    {
        if (! $this->exists || $this->fireModelEvent('deleting') === false) {
            return false;
        }

        $this->setKeysForSaveQuery($this->newModelQuery())->delete();
        $this->exists = false;
        $this->fireModelEvent('deleted', false);

        return true;
    }

    /**
     * `fresh()` and `refresh()` find the row by both key columns.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    protected function setKeysForSelectQuery($query)
    {
        return $this->whereThisRow($query);
    }

    /**
     * Saving and deleting address the row by both key columns.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    protected function setKeysForSaveQuery($query)
    {
        return $this->whereThisRow($query);
    }

    /**
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    private function whereThisRow(Builder $query): Builder
    {
        return $query
            ->where('order_id', $this->getAttribute('order_id'))
            ->where('user_id', $this->getAttribute('user_id'));
    }

    protected static function newFactory(): MessageReadFactory
    {
        return MessageReadFactory::new();
    }
}
