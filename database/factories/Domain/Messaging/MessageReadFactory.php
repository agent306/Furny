<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Messaging;

use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Models\Message;
use App\Domain\Messaging\Models\MessageRead;
use App\Domain\Orders\Models\Order;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: the customer of the order has opened the thread just now, without a last read message
 * (02 §9.2). The reader is resolved from the order, whichever state sets it.
 *
 * @extends Factory<MessageRead>
 */
final class MessageReadFactory extends Factory
{
    protected $model = MessageRead::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory(),
            'user_id' => static fn (array $attributes): mixed => Order::withTrashed()->whereKey($attributes['order_id'])->value('customer_id'),
            'last_read_at' => now()->toImmutable(),
            'last_read_message_id' => null,
        ];
    }

    /** Read by the given user (a staff member, or another party) instead of the customer. */
    public function by(User $reader): static
    {
        return $this->state(['user_id' => $reader->id]);
    }

    /** Read up to and including the given message. */
    public function lastRead(Message $message): static
    {
        return $this->state([
            'last_read_at' => now()->toImmutable(),
            'last_read_message_id' => $message->id,
        ]);
    }
}
