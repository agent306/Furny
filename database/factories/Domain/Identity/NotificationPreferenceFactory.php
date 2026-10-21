<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Identity;

use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\NotificationChannel;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<NotificationPreference>
 */
final class NotificationPreferenceFactory extends Factory
{
    protected $model = NotificationPreference::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'event_key' => 'orders.quote_sent',
            'channel' => NotificationChannel::Mail,
            'enabled' => true,
        ];
    }

    /**
     * `for($event, $channel)` (16 §5.1) selects the event and channel; any other argument keeps the
     * framework meaning (`for($user)` attaches the parent relation).
     *
     * @param  mixed  $factory
     * @param  mixed  $relationship
     */
    public function for($factory, $relationship = null): static
    {
        if (is_string($factory) && $relationship instanceof NotificationChannel) {
            return $this->state(['event_key' => $factory, 'channel' => $relationship]);
        }

        return parent::for($factory, is_string($relationship) ? $relationship : null);
    }

    public function disabled(): static
    {
        return $this->state(['enabled' => false]);
    }
}
