<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\ProductionVisibility;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\ProductionUpdateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §8.9. Production staff write the content of an update; the order and author are set by the
 * post-update action and `is_completion` only by the completion transition T20 (09 §8).
 *
 * @property string $id
 * @property string $order_id
 * @property string $author_id
 * @property string $stage
 * @property int $progress
 * @property string $title
 * @property string|null $body
 * @property ProductionVisibility $visibility
 * @property bool $is_completion
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['stage', 'progress', 'title', 'body', 'visibility'])]
final class ProductionUpdate extends Model implements HasMedia
{
    /** @use HasFactory<ProductionUpdateFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'progress' => 'integer',
            'visibility' => ProductionVisibility::class,
            'is_completion' => 'boolean',
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
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /** 02 §10: any number of jpg/png/webp photos on the private disk, with 400 px `thumb` and 1600 px `large` conversions. */
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

    protected static function newFactory(): ProductionUpdateFactory
    {
        return ProductionUpdateFactory::new();
    }
}
