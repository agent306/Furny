<?php

declare(strict_types=1);

use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Enums\ImportSourceKind;
use App\Domain\Imports\Enums\ImportStatus;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Support\Json\JsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Support\Documents;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * 02 §4.1, §10 and 06 §4.2.
 */
it('has the backed enum values of 02 §4.1', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(ImportStatus::class))->toBe(['uploaded', 'queued', 'preprocessing', 'recognizing', 'ready_for_review', 'accepted', 'discarded', 'failed', 'cancelled'])
        ->and($values(ImportMode::class))->toBe(['auto', 'trace'])
        ->and($values(ImportSourceKind::class))->toBe(['raster', 'pdf_vector', 'pdf_raster', 'dxf', 'heic'])
        ->and($values(AiProvider::class))->toBe(['anthropic', 'openai', 'openai_compatible', 'none']);
});

it('reports terminal and active-run statuses', function (ImportStatus $status, bool $terminal, bool $active): void {
    $import = BlueprintImport::factory()->make(['status' => $status]);

    expect($import->isTerminal())->toBe($terminal)
        ->and($import->isActiveRun())->toBe($active);
})->with([
    'uploaded' => [ImportStatus::Uploaded, false, false],
    'queued' => [ImportStatus::Queued, false, true],
    'preprocessing' => [ImportStatus::Preprocessing, false, true],
    'recognizing' => [ImportStatus::Recognizing, false, true],
    'ready_for_review' => [ImportStatus::ReadyForReview, false, false],
    'accepted' => [ImportStatus::Accepted, true, false],
    'discarded' => [ImportStatus::Discarded, true, false],
    'failed' => [ImportStatus::Failed, true, false],
    'cancelled' => [ImportStatus::Cancelled, true, false],
]);

it('applies the column defaults', function (): void {
    $project = Project::factory()->create();
    $import = $project->blueprintImports()->create([
        'user_id' => $project->owner_id,
        'original_filename' => 'flat.png',
    ])->fresh();

    expect($import->status)->toBe(ImportStatus::Uploaded)
        ->and($import->mode)->toBe(ImportMode::Auto)
        ->and($import->selected_page)->toBe(1)
        ->and($import->hints)->toBe([])
        ->and($import->review_version)->toBe(1)
        ->and($import->credits_reserved)->toBe(0)
        ->and($import->credits_charged)->toBe(0)
        ->and($import->attempts)->toBe(0)
        ->and($import->source_kind)->toBeNull()
        ->and($import->ai_provider)->toBeNull()
        ->and($import->result_document)->toBeNull()
        ->and($import->result_meta)->toBeNull()
        ->and($import->plan_id)->toBeNull()
        ->and($import->started_at)->toBeNull()
        ->and($import->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and(DB::table('blueprint_imports')->where('id', $import->id)->value('hints'))->toBe('{}');
});

it('creates an import uploaded by the project owner', function (): void {
    $import = BlueprintImport::factory()->create()->fresh();

    expect($import->user_id)->toBe($import->project->owner_id)
        ->and($import->user->is($import->project->owner))->toBeTrue()
        ->and($import->plan)->toBeNull()
        ->and($import->project->blueprintImports)->toHaveCount(1)
        ->and(User::query()->count())->toBe(1);
});

it('builds a state for every status', function (): void {
    $plan = Plan::factory()->create();

    $states = [
        [ImportStatus::Uploaded, BlueprintImport::factory()->uploaded()],
        [ImportStatus::Queued, BlueprintImport::factory()->queued()],
        [ImportStatus::Preprocessing, BlueprintImport::factory()->preprocessing()],
        [ImportStatus::Recognizing, BlueprintImport::factory()->recognizing()],
        [ImportStatus::ReadyForReview, BlueprintImport::factory()->readyForReview()],
        [ImportStatus::Accepted, BlueprintImport::factory()->accepted($plan)],
        [ImportStatus::Discarded, BlueprintImport::factory()->discarded()],
        [ImportStatus::Failed, BlueprintImport::factory()->failed('unreadable')],
        [ImportStatus::Cancelled, BlueprintImport::factory()->cancelled()],
    ];

    foreach ($states as [$status, $factory]) {
        expect($factory->create()->fresh()->status)->toBe($status);
    }
});

it('fills the run data of the status states', function (): void {
    $queued = BlueprintImport::factory()->queued()->create()->fresh();
    $running = BlueprintImport::factory()->recognizing()->create()->fresh();
    $ready = BlueprintImport::factory()->readyForReview()->create()->fresh();
    $failed = BlueprintImport::factory()->failed('unreadable')->create()->fresh();
    $plan = Plan::factory()->create();
    $accepted = BlueprintImport::factory()->accepted($plan)->create()->fresh();

    expect($queued->source_kind)->not->toBeNull()
        ->and($queued->credits_reserved)->toBeGreaterThan(0)
        ->and($running->started_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($running->attempts)->toBe(1)
        ->and($running->ai_provider)->toBeInstanceOf(AiProvider::class)
        ->and($ready->result_document['schemaVersion'])->toBe(1)
        ->and($ready->result_meta)->toBeArray()
        ->and($ready->finished_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($failed->error_code)->toBe('unreadable')
        ->and($accepted->plan->is($plan))->toBeTrue();
});

it('writes a structurally valid ImportResultMeta with the Laravel-added keys', function (): void {
    $meta = BlueprintImport::factory()->readyForReview()->create()->fresh()->result_meta;

    expect($meta)->toHaveKeys([
        'metaVersion', 'serviceVersion', 'pipelineVersion', 'sourceKind', 'providerRequested', 'providerUsed', 'model',
        'fallbackReason', 'drawingKind', 'pageImage', 'planRegion', 'scale', 'detectedUnitSystem', 'confidence',
        'reasons', 'warnings', 'timings', 'ocrTokens', 'counts', 'inspect', 'review',
    ])
        ->and($meta['pageImage'])->toHaveKeys(['width', 'height', 'sourcePage', 'dpi', 'rectified', 'deskewDeg', 'resampleFactor'])
        ->and($meta['scale'])->toHaveKeys(['mmPerPixel', 'method', 'residualPct', 'samples', 'rejected', 'confidence', 'anisotropyCorrected', 'roomLabelCheck', 'usedSamples'])
        ->and($meta['scale']['method'])->toBe('dimension_chain')
        ->and($meta['confidence'])->toHaveKeys(['walls', 'openings', 'rooms', 'overall'])
        ->and($meta['timings'])->toHaveKey('totalMs')
        ->and($meta['inspect'])->toHaveKeys(['isLikelyPhoto', 'suggestedCorners'])
        ->and($meta['review'])->toEqual(['reviewedIds' => [], 'scaleConfirmed' => true, 'unitConfirmed' => true, 'rescaleFactor' => 1])
        ->and($meta['warnings'])->toBe([]);
});

it('builds a ready-for-review import whose scale is a unconfirmed guess', function (): void {
    $import = BlueprintImport::factory()->scaleUnconfirmed()->create()->fresh();
    $meta = $import->result_meta;

    expect($import->status)->toBe(ImportStatus::ReadyForReview)
        ->and($import->result_document['schemaVersion'])->toBe(1)
        ->and($meta['review']['scaleConfirmed'])->toBeFalse()
        ->and($meta['review']['unitConfirmed'])->toBeTrue()
        ->and($meta['scale']['method'])->toBe('default_guess')
        ->and($meta['scale']['confidence'])->toBeLessThan(0.5)
        ->and($meta['scale']['residualPct'])->toBeNull()
        ->and($meta['warnings'][0]['code'])->toBe('scale_guessed')
        ->and($meta['warnings'][0]['params'])->toHaveKey('assumedLongEdgeMm');
});

it('does not mark an identical hints map dirty but notices false becoming null', function (): void {
    $import = BlueprintImport::factory()->create(['hints' => ['isPhoto' => false]])->fresh();

    $import->hints = ['isPhoto' => false];
    expect($import->isDirty('hints'))->toBeFalse();

    $import->hints = ['isPhoto' => null];
    expect($import->isDirty('hints'))->toBeTrue();

    $import->hints = ['isPhoto' => 0];
    expect($import->isDirty('hints'))->toBeTrue();
});

it('refuses a hints value that is not a map', function (): void {
    BlueprintImport::factory()->make()->hints = 42;
})->throws(InvalidArgumentException::class);

it('builds mode, source kind and credit states', function (): void {
    $trace = BlueprintImport::factory()->trace()->create()->fresh();
    $dxf = BlueprintImport::factory()->inspected(ImportSourceKind::Dxf)->create()->fresh();
    $pdf = BlueprintImport::factory()->inspected(ImportSourceKind::PdfVector)->create()->fresh();
    $reserved = BlueprintImport::factory()->reserved(5)->create()->fresh();
    $charged = BlueprintImport::factory()->charged(3)->create()->fresh();

    expect($trace->mode)->toBe(ImportMode::Trace)
        ->and($trace->ai_provider)->toBeNull()
        ->and($dxf->source_kind)->toBe(ImportSourceKind::Dxf)
        ->and($pdf->source_kind)->toBe(ImportSourceKind::PdfVector)
        ->and($pdf->page_count)->toBeGreaterThan(0)
        ->and($reserved->credits_reserved)->toBe(5)
        ->and($charged->credits_charged)->toBe(3);
});

it('keeps the empty record objects of a draft plan document', function (): void {
    $import = BlueprintImport::factory()->create(['result_document' => Documents::emptyPlan(['createdWith' => 'import'])])->fresh();

    expect(JsonDocument::encode($import->result_document))->toContain('"nodes":{}')
        ->and($import->result_document['meta']['createdWith'])->toBe('import');
});

it('round-trips hints', function (): void {
    $hints = ['corners' => [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]];

    $import = BlueprintImport::factory()->create(['hints' => $hints])->fresh();

    expect($import->hints)->toBe($hints)
        ->and(json_decode((string) DB::table('blueprint_imports')->where('id', $import->id)->value('hints'), true))->toBe($hints);

    $import->hints = [];
    $import->save();

    expect(DB::table('blueprint_imports')->where('id', $import->id)->value('hints'))->toBe('{}');
});

it('round-trips result_meta as an array', function (): void {
    $meta = ['scale' => ['mmPerPx' => 4.5], 'warnings' => ['image_downscaled'], 'inspect' => ['pages' => 2]];

    expect(BlueprintImport::factory()->create(['result_meta' => $meta])->fresh()->result_meta)->toEqual($meta);
});

it('nulls plan_id when the target plan is deleted', function (): void {
    $plan = Plan::factory()->create();
    $import = BlueprintImport::factory()->accepted($plan)->create();

    $plan->forceDelete();

    expect($import->fresh()->plan_id)->toBeNull();
});

it('restricts deleting the uploading user even when they own nothing else', function (): void {
    $uploader = User::factory()->create();
    BlueprintImport::factory()->create(['user_id' => $uploader->id]);

    expect(fn () => $uploader->forceDelete())->toThrow(QueryException::class);
});

it('cascades from project to imports', function (): void {
    $import = BlueprintImport::factory()->create();

    $import->project->forceDelete();

    expect(BlueprintImport::query()->count())->toBe(0);
});

it('registers the morph alias', function (): void {
    expect((new BlueprintImport)->getMorphClass())->toBe('blueprint_import');
});

it('declares the media collections of 02 §10', function (): void {
    $import = new BlueprintImport;
    $import->registerMediaCollections();
    $collections = collect($import->mediaCollections)->keyBy('name');

    expect($collections->keys()->sort()->values()->all())->toBe(['debug', 'normalized', 'pages', 'source'])
        ->and($collections['source']->diskName)->toBe('s3')
        ->and($collections['source']->singleFile)->toBeTrue()
        ->and($collections['normalized']->diskName)->toBe('s3')
        ->and($collections['normalized']->singleFile)->toBeTrue()
        ->and($collections['debug']->diskName)->toBe('s3')
        ->and($collections['debug']->singleFile)->toBeFalse()
        ->and($collections['pages']->diskName)->toBe('s3')
        ->and($collections['pages']->singleFile)->toBeFalse();
});

it('converts the normalized page image to a queued 1600 px wide webp preview', function (): void {
    $import = new BlueprintImport;
    $import->registerMediaConversions();

    $preview = collect($import->mediaConversions)->first(static fn ($conversion): bool => $conversion->getName() === 'preview');

    expect($preview)->not->toBeNull()
        ->and($preview->shouldBePerformedOn('normalized'))->toBeTrue()
        ->and($preview->shouldBePerformedOn('source'))->toBeFalse()
        ->and($preview->shouldBeQueued())->toBeTrue()
        ->and($preview->getManipulations()->toArray()['width'])->toBe([1600])
        ->and($preview->getResultExtension('png'))->toBe('webp');
});

it('accepts the declared source types of 06 §2.1 and no gif', function (): void {
    $import = new BlueprintImport;
    $import->registerMediaCollections();
    $source = collect($import->mediaCollections)->firstWhere('name', 'source');

    foreach (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'image/vnd.dxf', 'application/dxf', 'text/plain', 'application/octet-stream'] as $mime) {
        expect(in_array($mime, $source->acceptsMimeTypes, true))->toBeTrue("{$mime} should be accepted");
    }

    expect(in_array('image/gif', $source->acceptsMimeTypes, true))->toBeFalse();
});
