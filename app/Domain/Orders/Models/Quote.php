<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Support\Casts\AsJsonMap;
use App\Support\Numbers\QuoteNumber;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\QuoteFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;

/**
 * 02 §8.5. Estimators edit the validity, lead time, notes and terms of a draft; the totals are
 * derived by `QuoteCalculator` (08 §6.3), the snapshots, number, status and stamps are written by
 * the quote actions and the customer's reply, so none of them is mass-assignable.
 *
 * @property string $id
 * @property string $order_id
 * @property int $version
 * @property string $number
 * @property QuoteStatus $status
 * @property string $currency
 * @property bool $prices_include_tax
 * @property int $subtotal_minor
 * @property int $discount_minor
 * @property int $tax_minor
 * @property int $total_minor
 * @property list<array<string, mixed>> $tax_breakdown
 * @property CarbonImmutable $valid_until
 * @property int|null $lead_time_days
 * @property string|null $notes_to_customer
 * @property string $terms
 * @property string|null $internal_notes
 * @property array<string, mixed> $cost_snapshot
 * @property int $catalog_version
 * @property string $engine_version
 * @property string $created_by
 * @property CarbonImmutable|null $sent_at
 * @property CarbonImmutable|null $accepted_at
 * @property CarbonImmutable|null $declined_at
 * @property CarbonImmutable|null $expired_at
 * @property CarbonImmutable|null $superseded_at
 * @property CarbonImmutable|null $withdrawn_at
 * @property string|null $decline_reason
 * @property string|null $accepted_by_ip
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['valid_until', 'lead_time_days', 'notes_to_customer', 'terms', 'internal_notes'])]
final class Quote extends Model implements HasMedia
{
    /** @use HasFactory<QuoteFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    protected static function booted(): void
    {
        // `{order number}-Q{version}` (master §6.3); the order may already be soft-deleted.
        self::creating(static function (self $quote): void {
            if (blank($quote->number)) {
                $quote->number = QuoteNumber::for(
                    (string) Order::withTrashed()->whereKey($quote->order_id)->valueOrFail('number'),
                    (int) $quote->version,
                );
            }
        });
    }

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'status' => QuoteStatus::class,
            'prices_include_tax' => 'boolean',
            'subtotal_minor' => 'integer',
            'discount_minor' => 'integer',
            'tax_minor' => 'integer',
            'total_minor' => 'integer',
            'tax_breakdown' => 'array',
            'valid_until' => 'immutable_date',
            'lead_time_days' => 'integer',
            'cost_snapshot' => AsJsonMap::class,
            'catalog_version' => 'integer',
            'accepted_by_ip' => 'string',
            'sent_at' => 'immutable_datetime',
            'accepted_at' => 'immutable_datetime',
            'declined_at' => 'immutable_datetime',
            'expired_at' => 'immutable_datetime',
            'superseded_at' => 'immutable_datetime',
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
     * @return HasMany<QuoteLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(QuoteLine::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<QuoteNegotiation, $this>
     */
    public function negotiations(): HasMany
    {
        return $this->hasMany(QuoteNegotiation::class);
    }

    /** 02 §10: the rendered quote PDF, one file on the private disk (`RenderQuotePdf`). */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('pdf')
            ->useDisk('s3')
            ->singleFile()
            ->acceptsMimeTypes(['application/pdf']);
    }

    protected static function newFactory(): QuoteFactory
    {
        return QuoteFactory::new();
    }
}
