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
use stdClass;

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
            'result_meta' => self::resultMeta(),
            'review_version' => 1,
            'finished_at' => static fn (): mixed => now()->toImmutable(),
        ]);
    }

    /**
     * Ready for review with an unconfirmed, guessed scale: `review.scaleConfirmed` is false, the
     * scale method is `default_guess` with low confidence and the `scale_guessed` warning is set
     * (06 §11.3: accepting is blocked until the customer confirms the scale).
     */
    public function scaleUnconfirmed(): static
    {
        return $this->readyForReview()->state(['result_meta' => self::resultMeta(scaleGuessed: true)]);
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

    /**
     * A structurally valid `ImportResultMeta` (06 §6) for a plan with no entities, plus the keys
     * Laravel adds (`inspect`, `review`). Confirmed scale and unit unless `$scaleGuessed`.
     *
     * @return array<string, mixed>
     */
    private static function resultMeta(bool $scaleGuessed = false): array
    {
        return [
            'metaVersion' => 1,
            'serviceVersion' => '1.0.0',
            'pipelineVersion' => '1.0.0',
            'sourceKind' => 'raster',
            'providerRequested' => 'anthropic',
            'providerUsed' => 'anthropic',
            'model' => 'test-model',
            'fallbackReason' => null,
            'drawingKind' => 'architectural_line_drawing',
            'pageImage' => ['width' => 2400, 'height' => 1800, 'sourcePage' => 1, 'dpi' => null, 'rectified' => false, 'deskewDeg' => 0, 'resampleFactor' => 1],
            'planRegion' => ['x' => 0, 'y' => 0, 'w' => 2400, 'h' => 1800],
            'scale' => [
                'mmPerPixel' => 5.0,
                'method' => $scaleGuessed ? 'default_guess' : 'dimension_chain',
                'residualPct' => $scaleGuessed ? null : 0.8,
                'samples' => $scaleGuessed ? 0 : 6,
                'rejected' => 0,
                'confidence' => $scaleGuessed ? 0.3 : 0.95,
                'anisotropyCorrected' => false,
                'roomLabelCheck' => ['rooms' => 0, 'medianDiscrepancyPct' => null],
                'usedSamples' => [],
            ],
            'detectedUnitSystem' => 'metric',
            'confidence' => ['walls' => new stdClass, 'openings' => new stdClass, 'rooms' => new stdClass, 'overall' => $scaleGuessed ? 0.4 : 0.9],
            'reasons' => new stdClass,
            'warnings' => $scaleGuessed ? [['code' => 'scale_guessed', 'params' => ['assumedLongEdgeMm' => 12000], 'entityIds' => []]] : [],
            'timings' => ['totalMs' => 42_000],
            'ocrTokens' => ['count' => 0, 'meanConfidence' => 0, 'metricDimensionTokens' => 0, 'imperialTokens' => 0, 'roomNameTokens' => 0, 'areaTokens' => 0, 'sample' => []],
            'counts' => ['walls' => 0, 'openings' => 0, 'rooms' => 0, 'texts' => 0, 'candidatesWalls' => 0],
            'inspect' => ['isLikelyPhoto' => false, 'suggestedCorners' => null, 'dxf' => null],
            'review' => ['reviewedIds' => [], 'scaleConfirmed' => ! $scaleGuessed, 'unitConfirmed' => true, 'rescaleFactor' => 1],
        ];
    }
}
