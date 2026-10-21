<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Identity;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a pending invitation, valid for 72 hours, sent by a staff user (02 §1.5).
 *
 * @extends Factory<StaffInvitation>
 */
final class StaffInvitationFactory extends Factory
{
    protected $model = StaffInvitation::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'email' => fake()->unique()->safeEmail(),
            'name' => fake()->name(),
            'role' => StaffRole::Estimator,
            'invited_by' => User::factory()->admin(),
            'expires_at' => now()->addHours(72),
            'accepted_at' => null,
            'revoked_at' => null,
            'user_id' => null,
        ];
    }

    public function pending(): static
    {
        return $this->state(fn (): array => [
            'expires_at' => now()->addHours(72),
            'accepted_at' => null,
            'revoked_at' => null,
            'user_id' => null,
        ]);
    }

    public function accepted(): static
    {
        return $this->state(fn (array $attributes): array => [
            'accepted_at' => now(),
            'user_id' => User::factory()->staff($attributes['role']),
        ]);
    }

    public function revoked(): static
    {
        return $this->state(fn (): array => ['revoked_at' => now()]);
    }

    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subHour()]);
    }

    public function role(StaffRole $role): static
    {
        return $this->state(['role' => $role]);
    }
}
