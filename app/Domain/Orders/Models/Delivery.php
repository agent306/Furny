<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\DeliveryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §8.11: the single delivery record of an order. Staff schedule the window and note the
 * installation and recipient; the order, the delivery stamp (T22, 09 §9) and the recorder are
 * written by the delivery actions.
 *
 * @property string $id
 * @property string $order_id
 * @property CarbonImmutable|null $scheduled_for
 * @property CarbonImmutable|null $scheduled_until
 * @property CarbonImmutable|null $delivered_at
 * @property bool $installed
 * @property string|null $recipient_name
 * @property string|null $notes
 * @property string|null $recorded_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['scheduled_for', 'scheduled_until', 'installed', 'recipient_name', 'notes'])]
final class Delivery extends Model implements HasMedia
{
    /** @use HasFactory<DeliveryFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'scheduled_for' => 'immutable_datetime',
            'scheduled_until' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
            'installed' => 'boolean',
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
    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    /** 02 §10: delivery photos, jpg/png/webp on the private disk, with 400 px `thumb` and 1600 px `large` conversions. */
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

    protected static function newFactory(): DeliveryFactory
    {
        return DeliveryFactory::new();
    }
}
