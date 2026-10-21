<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Imports;

use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Enums\ImportSourceKind;
use App\Domain\Imports\Enums\ImportStatus;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use Database\Factories\Support\Documents;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a just-uploaded, not yet inspected auto import in a new project, uploaded by that
 * project's customer (02 §4.1). The uploader is resolved from the project. Status states set the
 * run data the matching action would have written; `pages`/`normalized` media and the vision
 * fixtures arrive with P6.
 *
 * @extends Factory<BlueprintImport>
 */
final class BlueprintImportFactory extends Factory
{
    protected $model = BlueprintImport::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'user_id' => static fn (array $attributes): mixed => Project::withTrashed()->whereKey($attributes['project_id'])->value('owner_id'),
            'status' => ImportStatus::Uploaded,
            'mode' => ImportMode::Auto,
            'original_filename' => 'living-room-plan.png',
        ];
    }

    public function uploaded(): static
    {
        return $this->state(['status' => ImportStatus::Uploaded]);
    }

    /** The upload has been sniffed and (for PDFs) counted by `PrepareImportPreview`. */
    public function inspected(ImportSourceKind $kind = ImportSourceKind::Raster): static
    {
        return $this->state(fn (): array => match ($kind) {
            ImportSourceKind::Raster => ['source_kind' => $kind, 'mime_type' => 'image/png', 'file_size_bytes' => 482_113, 'page_count' => null],
            ImportSourceKind::Heic => ['source_kind' => $kind, 'mime_type' => 'image/heic', 'file_size_bytes' => 2_204_511, 'page_count' => null],
            ImportSourceKind::PdfVector, ImportSourceKind::PdfRaster => ['source_kind' => $kind, 'mime_type' => 'application/pdf', 'file_size_bytes' => 1_254_000, 'page_count' => 3],
            ImportSourceKind::Dxf => ['source_kind' => $kind, 'mime_type' => 'application/dxf', 'file_size_bytes' => 96_320, 'page_count' => null],
        });
    }

    /** Waiting for a worker, one credit reserved. */
    public function queued(): static
    {
        return $this->inspected()->state([
            'status' => ImportStatus::Queued,
            'ai_provider' => AiProvider::Anthropic,
            'ai_model' => 'test-model',
            'credits_reserved' => 1,
        ]);
    }

    public function preprocessing(): static
    {
        return $this->queued()->state([
            'status' => ImportStatus::Preprocessing,
            'attempts' => 1,
            'started_at' => static fn (): mixed => now()->toImmutable(),
        ]);
    }

    public function recognizing(): static
    {
        return $this->preprocessing()->state(['status' => ImportStatus::Recognizing]);
    }

    /** Recognized: a draft plan document is waiting for the customer's review, the credit is charged. */
    public function readyForReview(): static
    {
        return $this->recognizing()->state([
            'status' => ImportStatus::ReadyForReview,
            'credits_reserved' => 0,
            'credits_charged' => 1,
            'result_document' => Documents::emptyPlan(['createdWith' => 'import']),
            'result_meta' => ['metaVersion' => 1, 'sourceKind' => 'raster', 'warnings' => []],
            'review_version' => 1,
            'finished_at' => static fn (): mixed => now()->toImmutable(),
        ]);
    }

    /** Accepted into the given plan, or into a new plan of the same project. */
    public function accepted(?Plan $plan = null): static
    {
        return $this->readyForReview()->state([
            'status' => ImportStatus::Accepted,
            'plan_id' => $plan->id ?? static fn (array $attributes): Factory => Plan::factory()->state(['project_id' => $attributes['project_id']]),
        ]);
    }

    public function discarded(): static
    {
        return $this->readyForReview()->state(['status' => ImportStatus::Discarded]);
    }

    /** Failed during the run: the reservation is released, no result. */
    public function failed(string $errorCode = 'unreadable'): static
    {
        return $this->preprocessing()->state([
            'status' => ImportStatus::Failed,
            'credits_reserved' => 0,
            'error_code' => $errorCode,
            'error_message' => 'Failed in test.',
            'finished_at' => static fn (): mixed => now()->toImmutable(),
        ]);
    }

    public function cancelled(): static
    {
        return $this->state(['status' => ImportStatus::Cancelled, 'finished_at' => static fn (): mixed => now()->toImmutable()]);
    }

    /** Background-only tracing: no recognition, no provider, no credits. */
    public function trace(): static
    {
        return $this->state(['mode' => ImportMode::Trace, 'ai_provider' => null, 'ai_model' => null, 'credits_reserved' => 0]);
    }

    public function reserved(int $credits): static
    {
        return $this->state(['credits_reserved' => $credits]);
    }

    public function charged(int $credits): static
    {
        return $this->state(['credits_charged' => $credits]);
    }
}
