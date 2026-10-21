<?php

declare(strict_types=1);

namespace App\Domain\Messaging\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Orders\Models\Order;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Messaging\MessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §9.1: one entry of an order's thread. An author writes only the body; the order, the author,
 * the kind (`text` or `internal_note` by the post action, `system` by the order events), the system
 * data and the edit stamp are written by the messaging actions (09 §10), so none is mass-assignable.
 *
 * @property string $id
 * @property string $order_id
 * @property string|null $author_id
 * @property MessageKind $kind
 * @property string $body
 * @property string|null $system_event
 * @property array<string, mixed>|null $system_payload
 * @property CarbonImmutable|null $edited_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['body'])]
final class Message extends Model implements HasMedia
{
    /** @use HasFactory<MessageFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'kind' => MessageKind::class,
            'system_payload' => 'array',
            'edited_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
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
     * Null for system messages.
     *
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /** 02 §10: jpg, png, webp or pdf files on the private disk; the limit of 5 files of 15 MB is checked when uploading. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('attachments')
            ->useDisk('s3')
            ->acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    }

    /** `thumb`: 400 px wide, made for images (a PDF only gets one where the PDF image generator is available). */
    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('thumb')
            ->performOnCollections('attachments')
            ->width(400);
    }

    protected static function newFactory(): MessageFactory
    {
        return MessageFactory::new();
    }
}
