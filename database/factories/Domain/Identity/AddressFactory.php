<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Identity;

use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Address>
 */
final class AddressFactory extends Factory
{
    protected $model = Address::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'label' => 'Home',
            'line1' => fake()->streetAddress(),
            'line2' => null,
            'city' => 'Bengaluru',
            'region' => 'Karnataka',
            'postal_code' => '560001',
            'country_code' => 'IN',
        ];
    }

    public function forUser(User $user): static
    {
        return $this->state(['user_id' => $user->id]);
    }

    public function international(string $countryCode): static
    {
        return $this->state([
            'city' => fake()->city(),
            'region' => null,
            'postal_code' => fake()->postcode(),
            'country_code' => strtoupper($countryCode),
        ]);
    }
}
