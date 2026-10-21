<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Projects;

use App\Domain\Identity\Models\User;
use App\Domain\Projects\Enums\PlanRevisionReason;
use App\Domain\Projects\Enums\PlanSource;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\PlanRevision;
use App\Domain\Projects\Models\Project;
use Carbon\CarbonImmutable;
use Database\Factories\Concerns\ProvidesTinyPng;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a drawn "Ground floor" with the empty plan document at version 1 (02 §3.2).
 *
 * @extends Factory<Plan>
 */
final class PlanFactory extends Factory
{
    use ProvidesTinyPng;

    protected $model = Plan::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'name' => 'Ground floor',
            'level_index' => 0,
            'source' => PlanSource::Drawn,
            'working_document' => Documents::emptyPlan(),
            'working_version' => 1,
            'schema_version' => 1,
        ];
    }

    /** `empty`, `hdb-3room`, `brochure-2bhk` or a plan starter such as `rect-4000x3000`. */
    public function fromFixture(string $name): static
    {
        return $this->state(['working_document' => Documents::plan($name)]);
    }

    public function imported(): static
    {
        return $this->originatingFrom(PlanSource::Imported, 'import');
    }

    public function traced(): static
    {
        return $this->originatingFrom(PlanSource::Traced, 'trace');
    }

    public function duplicated(): static
    {
        return $this->state(['source' => PlanSource::Duplicated]);
    }

    /** Locked by the given staff member, or by a new support user. */
    public function locked(?User $staff = null): static
    {
        return $this->state([
            'locked_at' => static fn (): CarbonImmutable => now()->toImmutable(),
            'locked_by' => $staff->id ?? User::factory()->staff(),
        ]);
    }

    /** `$count` manual checkpoints numbered 1..n, the last one is `current_revision_id`. */
    public function withRevisions(int $count): static
    {
        return $this->afterCreating(function (Plan $plan) use ($count): void {
            $last = null;

            for ($number = 1; $number <= $count; $number++) {
                $last = PlanRevision::factory()->for($plan)->create([
                    'number' => $number,
                    'document' => $plan->working_document,
                    'reason' => PlanRevisionReason::ManualCheckpoint,
                ]);
            }

            if ($last !== null) {
                $plan->forceFill(['current_revision_id' => $last->id])->save();
            }
        });
    }

    public function withThumbnail(): static
    {
        return $this->afterCreating(static function (Plan $plan): void {
            $plan->addMediaFromString(self::tinyPng())
                ->usingFileName('thumbnail.png')
                ->toMediaCollection('thumbnail');
        });
    }

    private function originatingFrom(PlanSource $source, string $createdWith): static
    {
        return $this->state(fn (array $attributes): array => [
            'source' => $source,
            'working_document' => Documents::emptyPlan(['createdWith' => $createdWith]),
        ]);
    }
}
