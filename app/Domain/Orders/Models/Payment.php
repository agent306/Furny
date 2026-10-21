<?php

declare(strict_types=1);

namespace App\Domain\Orders\Models;

use App\Domain\Orders\Enums\PaymentGateway;
use App\Domain\Orders\Enums\PaymentKind;
use App\Domain\Orders\Enums\PaymentMethod;
use App\Domain\Orders\Enums\PaymentStatus;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Orders\PaymentFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * 02 §8.12 (phase 2, D16): the table is migrated so the schema stays stable, but v1 has no
 * payment logic, routes or UI. The model carries casts only; nothing is mass-assignable and
 * nothing references it.
 *
 * @property string $id
 * @property string $order_id
 * @property string|null $quote_id
 * @property PaymentKind $kind
 * @property int $amount_minor
 * @property string $currency
 * @property PaymentMethod $method
 * @property PaymentStatus $status
 * @property PaymentGateway|null $gateway
 * @property string|null $gateway_reference
 * @property CarbonImmutable|null $paid_at
 * @property string|null $recorded_by
 * @property string|null $notes
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
final class Payment extends Model
{
    /** @use HasFactory<PaymentFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'kind' => PaymentKind::class,
            'amount_minor' => 'integer',
            'method' => PaymentMethod::class,
            'status' => PaymentStatus::class,
            'gateway' => PaymentGateway::class,
            'paid_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function newFactory(): PaymentFactory
    {
        return PaymentFactory::new();
    }
}
