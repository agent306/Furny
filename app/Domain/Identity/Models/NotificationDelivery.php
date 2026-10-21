<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Identity\Enums\DeliveryDriver;
use App\Domain\Identity\Enums\DeliveryStatus;
use App\Domain\Shared\Enums\NotificationChannel;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Identity\NotificationDeliveryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * 02 §1.7: every WhatsApp and SMS send attempt. `to_masked` and `to_hash` are the only stored
 * form of the recipient number (13 §9).
 *
 * @property string $id
 * @property string|null $notification_id
 * @property string|null $user_id
 * @property string $event_key
 * @property NotificationChannel $channel
 * @property DeliveryDriver $driver
 * @property string $to_masked
 * @property string $to_hash
 * @property string|null $template_name
 * @property string|null $provider_message_id
 * @property DeliveryStatus $status
 * @property string|null $error_code
 * @property string|null $error_title
 * @property string|null $pricing_category
 * @property bool|null $billable
 * @property string|null $fallback_of_id
 * @property array<string, mixed>|null $context
 * @property int $attempts
 * @property CarbonImmutable|null $accepted_at
 * @property CarbonImmutable|null $sent_at
 * @property CarbonImmutable|null $delivered_at
 * @property CarbonImmutable|null $read_at
 * @property CarbonImmutable|null $failed_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable([
    'notification_id', 'user_id', 'event_key', 'channel', 'driver', 'to_masked', 'to_hash', 'template_name',
    'provider_message_id', 'status', 'error_code', 'error_title', 'pricing_category', 'billable',
    'fallback_of_id', 'context', 'attempts', 'accepted_at', 'sent_at', 'delivered_at', 'read_at', 'failed_at',
])]
final class NotificationDelivery extends Model
{
    /** @use HasFactory<NotificationDeliveryFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'channel' => NotificationChannel::class,
            'driver' => DeliveryDriver::class,
            'status' => DeliveryStatus::class,
            'billable' => 'bool',
            'context' => 'array',
            'attempts' => 'int',
            'accepted_at' => 'immutable_datetime',
            'sent_at' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
            'read_at' => 'immutable_datetime',
            'failed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
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
     * The failed WhatsApp delivery this SMS replaces (12 §7.8).
     *
     * @return BelongsTo<self, $this>
     */
    public function fallbackOf(): BelongsTo
    {
        return $this->belongsTo(self::class, 'fallback_of_id');
    }

    /**
     * @return HasMany<self, $this>
     */
    public function fallbacks(): HasMany
    {
        return $this->hasMany(self::class, 'fallback_of_id');
    }

    protected static function newFactory(): NotificationDeliveryFactory
    {
        return NotificationDeliveryFactory::new();
    }
}
