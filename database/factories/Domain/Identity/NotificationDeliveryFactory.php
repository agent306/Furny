<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Identity;

use App\Domain\Identity\Enums\DeliveryDriver;
use App\Domain\Identity\Enums\DeliveryStatus;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\NotificationChannel;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a pending WhatsApp send through the `log` driver to a generated Indian mobile number
 * (02 §1.7).
 *
 * @extends Factory<NotificationDelivery>
 */
final class NotificationDeliveryFactory extends Factory
{
    protected $model = NotificationDelivery::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $phone = '+919'.fake()->numerify('#########');

        return [
            'notification_id' => fake()->uuid(),
            'user_id' => User::factory(),
            'event_key' => 'order.quoted',
            'channel' => NotificationChannel::Whatsapp,
            'driver' => DeliveryDriver::Log,
            'to_masked' => substr($phone, 0, 3).'******'.substr($phone, -4),
            'to_hash' => hash_hmac('sha256', $phone, (string) config('app.key')),
            'template_name' => null,
            'provider_message_id' => null,
            'status' => DeliveryStatus::Pending,
            'error_code' => null,
            'error_title' => null,
            'pricing_category' => null,
            'billable' => null,
            'fallback_of_id' => null,
            'context' => null,
            'attempts' => 0,
            'accepted_at' => null,
            'sent_at' => null,
            'delivered_at' => null,
            'read_at' => null,
            'failed_at' => null,
        ];
    }

    public function sms(): static
    {
        return $this->state(['channel' => NotificationChannel::Sms]);
    }

    public function driver(DeliveryDriver $driver): static
    {
        return $this->state(['driver' => $driver]);
    }

    public function accepted(): static
    {
        return $this->state(fn (): array => [
            'status' => DeliveryStatus::Accepted,
            'provider_message_id' => 'wamid.'.fake()->unique()->bothify('????????????'),
            'attempts' => 1,
            'accepted_at' => now(),
        ]);
    }

    public function sent(): static
    {
        return $this->accepted()->state(fn (): array => [
            'status' => DeliveryStatus::Sent,
            'sent_at' => now(),
        ]);
    }

    public function delivered(): static
    {
        return $this->sent()->state(fn (): array => [
            'status' => DeliveryStatus::Delivered,
            'delivered_at' => now(),
        ]);
    }

    public function read(): static
    {
        return $this->delivered()->state(fn (): array => [
            'status' => DeliveryStatus::Read,
            'read_at' => now(),
        ]);
    }

    public function failed(string $code = '131026', string $title = 'Message undeliverable'): static
    {
        return $this->state(fn (): array => [
            'status' => DeliveryStatus::Failed,
            'attempts' => 1,
            'error_code' => $code,
            'error_title' => $title,
            'failed_at' => now(),
        ]);
    }

    /** An SMS fallback of a failed WhatsApp delivery (12 §7.8): same user, event and recipient. */
    public function fallbackOf(NotificationDelivery $original): static
    {
        return $this->state(fn (): array => [
            'fallback_of_id' => $original->id,
            'notification_id' => $original->notification_id,
            'user_id' => $original->user_id,
            'event_key' => $original->event_key,
            'to_masked' => $original->to_masked,
            'to_hash' => $original->to_hash,
            'context' => $original->context,
        ]);
    }
}
