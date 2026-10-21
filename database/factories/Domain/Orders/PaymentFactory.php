<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Orders;

use App\Domain\Orders\Enums\PaymentKind;
use App\Domain\Orders\Enums\PaymentMethod;
use App\Domain\Orders\Enums\PaymentStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Payment;
use App\Domain\Orders\States\Accepted;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a succeeded advance by bank transfer on an accepted order, paid an hour ago, outside any
 * gateway (02 §8.12). Payments are phase 2 (D16); this exists to prove the schema and the casts.
 *
 * @extends Factory<Payment>
 */
final class PaymentFactory extends Factory
{
    protected $model = Payment::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory()->inState(Accepted::class),
            'kind' => PaymentKind::Advance,
            'amount_minor' => 1_000_000,
            'currency' => 'INR',
            'method' => PaymentMethod::BankTransfer,
            'status' => PaymentStatus::Succeeded,
            'paid_at' => now()->subHour()->toImmutable(),
        ];
    }
}
