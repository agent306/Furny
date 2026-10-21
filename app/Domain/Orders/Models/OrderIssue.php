<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\IssueStatus;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\OrderIssueFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §8.10. The customer describes the problem; the order, the item, the reporter, the status and
 * the resolution are written by the issue actions (09 §8).
 *
 * @property string $id
 * @property string $order_id
 * @property string|null $order_item_id
 * @property string $raised_by
 * @property string $description
 * @property IssueStatus $status
 * @property string|null $resolution_note
 * @property string|null $resolved_by
 * @property CarbonImmutable|null $resolved_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['description'])]
final class OrderIssue extends Model implements HasMedia
{
    /** @use HasFactory<OrderIssueFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'status' => IssueStatus::class,
            'resolved_at' => 'immutable_datetime',
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
     * @return BelongsTo<OrderItem, $this>
     */
    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function raisedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'raised_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    /** 02 §10: the customer's evidence, jpg/png/webp on the private disk, with 400 px `thumb` and 1600 px `large` conversions. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('photos')
            ->useDisk('s3')
            ->acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp']);
    }

    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('thumb')
            ->performOnCollections('photos')
            ->width(400);

        $this->addMediaConversion('large')
            ->performOnCollections('photos')
            ->width(1600);
    }

    protected static function newFactory(): OrderIssueFactory
    {
        return OrderIssueFactory::new();
    }
}
