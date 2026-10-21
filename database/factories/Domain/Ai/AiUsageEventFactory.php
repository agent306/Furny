<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Ai;

use App\Domain\Ai\Enums\AiFeature;
use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Ai\Enums\AiUsageStatus;
use App\Domain\Ai\Models\AiUsageEvent;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: one succeeded Anthropic recognition call for an import of the same customer (02 §7.2).
 * The import is created with the user as its project owner and uploader, whichever state sets the
 * user. `providerTest()` is the admin "Test connection" call, which has no import.
 *
 * @extends Factory<AiUsageEvent>
 */
final class AiUsageEventFactory extends Factory
{
    protected $model = AiUsageEvent::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'feature' => AiFeature::BlueprintRecognition,
            'provider' => AiProvider::Anthropic,
            'model' => 'test-model',
            'request_count' => 1,
            'input_tokens' => 1_200,
            'output_tokens' => 300,
            'image_count' => 1,
            'cost_micro_usd' => 10_800,
            'duration_ms' => 8_000,
            'status' => AiUsageStatus::Succeeded,
            'reference_type' => 'blueprint_import',
            'reference_id' => static fn (array $attributes): Factory => BlueprintImport::factory()
                ->for(Project::factory()->state(['owner_id' => $attributes['user_id']]))
                ->state(['user_id' => $attributes['user_id']]),
        ];
    }

    /** The admin "Test connection" call (18 §5.3): no import, no user-facing cost. */
    public function providerTest(): static
    {
        return $this->state([
            'feature' => AiFeature::ProviderTest,
            'request_count' => 1,
            'input_tokens' => 20,
            'output_tokens' => 5,
            'image_count' => 0,
            'cost_micro_usd' => 0,
            'duration_ms' => 400,
            'reference_type' => null,
            'reference_id' => null,
        ]);
    }

    public function failed(): static
    {
        return $this->state(['status' => AiUsageStatus::Failed]);
    }
}
