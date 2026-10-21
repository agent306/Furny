<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Messaging;

use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\Order;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a text message written by the customer of the order (02 §9.1). The author is resolved
 * from the order, whichever state sets it. Staff messages use `by()`; `system()` and `internalNote()`
 * set the kind and its matching author.
 *
 * @extends Factory<Message>
 */
final class MessageFactory extends Factory
{
    protected $model = Message::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory(),
            'author_id' => static fn (array $attributes): mixed => Order::withTrashed()->whereKey($attributes['order_id'])->value('customer_id'),
            'kind' => MessageKind::Text,
            'body' => 'Could you confirm the finish of the wardrobe doors?',
        ];
    }

    /** Written by the given user (a staff member for a staff reply). */
    public function by(User $author): static
    {
        return $this->state(['author_id' => $author->id]);
    }

    /**
     * Posted by the order events: no author, the event key and its parameters, and no body (the UI
     * renders `messages.system.{event}` from the key and payload, 09 §10).
     *
     * @param  array<string, mixed>  $payload
     */
    public function system(string $event = 'order.submitted', array $payload = []): static
    {
        return $this->state([
            'author_id' => null,
            'kind' => MessageKind::System,
            'body' => '',
            'system_event' => $event,
            'system_payload' => $payload,
        ]);
    }

    /** A staff-only note by a staff member. */
    public function internalNote(): static
    {
        return $this->state([
            'author_id' => User::factory()->staff(),
            'kind' => MessageKind::InternalNote,
            'body' => 'Customer prefers calls after 6 pm.',
        ]);
    }

    /** Edited by the author a minute after posting. */
    public function edited(): static
    {
        return $this->state([
            'created_at' => now()->subMinutes(5)->toImmutable(),
            'edited_at' => now()->subMinutes(4)->toImmutable(),
        ]);
    }
}
