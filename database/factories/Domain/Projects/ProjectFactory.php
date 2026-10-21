<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Projects;

use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\User;
use App\Domain\Projects\Enums\ProjectStatus;
use App\Domain\Projects\Enums\PropertyType;
use App\Domain\Projects\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: an active apartment project created by its customer owner (02 §3.1).
 *
 * @extends Factory<Project>
 */
final class ProjectFactory extends Factory
{
    protected $model = Project::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'owner_id' => User::factory(),
            'created_by' => static fn (array $attributes): mixed => $attributes['owner_id'],
            'name' => 'My apartment',
            'property_type' => PropertyType::Apartment,
            'site_address_id' => null,
            'notes' => null,
            'status' => ProjectStatus::Active,
        ];
    }

    public function forCustomer(User $customer): static
    {
        return $this->state(['owner_id' => $customer->id]);
    }

    public function archived(): static
    {
        return $this->state(['status' => ProjectStatus::Archived]);
    }

    /** A site address that belongs to the project's owner, whichever state sets the owner. */
    public function withSiteAddress(): static
    {
        return $this->state([
            'site_address_id' => static fn (array $attributes): Factory => Address::factory()->state(['user_id' => $attributes['owner_id']]),
        ]);
    }

    public function createdByStaff(User $staff): static
    {
        return $this->state(['created_by' => $staff->id]);
    }
}
