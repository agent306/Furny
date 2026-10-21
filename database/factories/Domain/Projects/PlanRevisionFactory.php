<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Projects;

use App\Domain\Projects\Enums\PlanRevisionReason;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\PlanRevision;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: checkpoint number 1 of a new plan holding the empty document (02 §3.3).
 *
 * @extends Factory<PlanRevision>
 */
final class PlanRevisionFactory extends Factory
{
    protected $model = PlanRevision::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'plan_id' => Plan::factory(),
            'number' => 1,
            'document' => Documents::emptyPlan(),
            'schema_version' => 1,
            'reason' => PlanRevisionReason::ManualCheckpoint,
            'label' => null,
            'author_id' => null,
        ];
    }

    public function reason(PlanRevisionReason $reason): static
    {
        return $this->state(['reason' => $reason]);
    }

    public function manualCheckpoint(): static
    {
        return $this->reason(PlanRevisionReason::ManualCheckpoint);
    }

    public function importAccepted(): static
    {
        return $this->reason(PlanRevisionReason::ImportAccepted);
    }

    public function beforeRestore(): static
    {
        return $this->reason(PlanRevisionReason::BeforeRestore);
    }

    public function staffEdit(): static
    {
        return $this->reason(PlanRevisionReason::StaffEdit);
    }

    public function autoDaily(): static
    {
        return $this->reason(PlanRevisionReason::AutoDaily);
    }
}
