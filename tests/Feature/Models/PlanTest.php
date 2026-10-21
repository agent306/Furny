<?php

declare(strict_types=1);

use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\User;
use App\Domain\Projects\Enums\PlanRevisionReason;
use App\Domain\Projects\Enums\PlanSource;
use App\Domain\Projects\Enums\ProjectStatus;
use App\Domain\Projects\Enums\PropertyType;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\PlanRevision;
use App\Domain\Projects\Models\Project;
use App\Support\Json\JsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Support\Documents;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

it('has the backed enum values of 02 §3', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(PropertyType::class))->toBe(['apartment', 'independent_house', 'villa', 'office', 'other'])
        ->and($values(ProjectStatus::class))->toBe(['active', 'archived'])
        ->and($values(PlanSource::class))->toBe(['drawn', 'imported', 'traced', 'duplicated'])
        ->and($values(PlanRevisionReason::class))->toBe(['manual_checkpoint', 'import_accepted', 'before_restore', 'staff_edit', 'auto_daily']);
});

it('builds the empty plan document of 03 §1', function (): void {
    $doc = Documents::emptyPlan();

    expect($doc['schemaVersion'])->toBe(1)
        ->and($doc['meta'])->toBe(['defaultWallHeight' => 2700, 'defaultWallThickness' => 115, 'floorThickness' => 150, 'northAngle' => null, 'createdWith' => 'editor'])
        ->and(Documents::emptyPlan(['createdWith' => 'import'])['meta']['createdWith'])->toBe('import')
        ->and(array_keys($doc))->toBe(['schemaVersion', 'meta', 'nodes', 'walls', 'openings', 'rooms', 'placements', 'fixtures', 'annotations', 'background', 'view'])
        ->and(JsonDocument::encode($doc))->toBe(
            '{"schemaVersion":1,"meta":{"defaultWallHeight":2700,"defaultWallThickness":115,"floorThickness":150,"northAngle":null,"createdWith":"editor"},'
            .'"nodes":{},"walls":{},"openings":{},"rooms":{},"placements":{},"fixtures":{},'
            .'"annotations":{"dimensions":{},"labels":{}},"background":null,"view":{"mode2d":null,"mode3d":null,"lastMode":"2d"}}',
        );
});

it('keeps empty record objects when a plan is saved and reloaded', function (): void {
    $plan = Plan::factory()->create();

    $document = JsonDocument::encode($plan->fresh()->working_document);

    expect($document)->toContain('"nodes":{}')
        ->and($document)->toContain('"walls":{}')
        ->and($plan->fresh()->working_document['annotations']['labels'])->toBeInstanceOf(stdClass::class)
        ->and(DB::table('plans')->where('id', $plan->id)->value('working_document'))->toContain('"nodes": {}');
});

it('accepts a JSON string for a document and rejects invalid JSON', function (): void {
    $plan = Plan::factory()->create(['working_document' => JsonDocument::encode(Documents::emptyPlan(['northAngle' => 45.0]))]);

    expect($plan->fresh()->working_document['meta']['northAngle'])->toBe(45.0);

    $plan->working_document = '{"broken":';
})->throws(JsonException::class);

it('does not mark an identical document dirty but notices a real change', function (): void {
    $plan = Plan::factory()->create()->fresh();
    $document = $plan->working_document;

    $plan->working_document = $document;
    expect($plan->isDirty('working_document'))->toBeFalse();

    $plan->working_document = JsonDocument::encode($document);
    expect($plan->isDirty('working_document'))->toBeFalse();

    $reordered = array_reverse($document, true);
    $plan->working_document = $reordered;
    expect($plan->isDirty('working_document'))->toBeFalse();

    $document['meta']['northAngle'] = 10;
    $plan->working_document = $document;
    expect($plan->isDirty('working_document'))->toBeTrue();
});

it('treats an empty object and an empty list as different documents', function (): void {
    $plan = Plan::factory()->create()->fresh();
    $document = $plan->working_document;
    $document['nodes'] = [];

    $plan->working_document = $document;

    expect($plan->isDirty('working_document'))->toBeTrue();
});

it('lets an unchanged revision be saved without tripping the immutability guard', function (): void {
    $revision = PlanRevision::factory()->create()->fresh();

    $revision->document = $revision->document;

    expect($revision->save())->toBeTrue();
});

it('applies the column defaults', function (): void {
    $project = Project::factory()->create()->fresh();
    $plan = $project->plans()->create([
        'source' => PlanSource::Drawn,
        'working_document' => Documents::emptyPlan(),
    ])->fresh();

    expect($plan->name)->toBe('Ground floor')
        ->and($plan->level_index)->toBe(0)
        ->and($plan->working_version)->toBe(1)
        ->and($plan->schema_version)->toBe(1)
        ->and($plan->summary)->toBe([])
        ->and($plan->source)->toBe(PlanSource::Drawn)
        ->and($plan->working_saved_at)->toBeNull()
        ->and($plan->current_revision_id)->toBeNull()
        ->and($plan->isLocked())->toBeFalse()
        ->and($project->property_type)->toBe(PropertyType::Apartment)
        ->and($project->status)->toBe(ProjectStatus::Active)
        ->and($project->created_at)->toBeInstanceOf(CarbonImmutable::class);
});

it('locks a plan for everyone', function (): void {
    $staff = User::factory()->staff()->create();
    $plan = Plan::factory()->locked($staff)->create()->fresh();

    expect($plan->isLocked())->toBeTrue()
        ->and($plan->locked_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($plan->lockedBy->is($staff))->toBeTrue()
        ->and(Plan::factory()->locked()->create()->isLocked())->toBeTrue()
        ->and(Plan::factory()->create()->isLocked())->toBeFalse();
});

it('builds source states with the matching document origin', function (): void {
    $imported = Plan::factory()->imported()->create()->fresh();
    $traced = Plan::factory()->traced()->create()->fresh();
    $duplicated = Plan::factory()->duplicated()->create()->fresh();

    expect($imported->source)->toBe(PlanSource::Imported)
        ->and($imported->working_document['meta']['createdWith'])->toBe('import')
        ->and($traced->source)->toBe(PlanSource::Traced)
        ->and($traced->working_document['meta']['createdWith'])->toBe('trace')
        ->and($duplicated->source)->toBe(PlanSource::Duplicated)
        ->and($duplicated->working_document['meta']['createdWith'])->toBe('editor');
});

it('creates plans from the empty fixture and refuses unknown fixtures', function (): void {
    $plan = Plan::factory()->fromFixture('empty')->create()->fresh();

    expect($plan->working_document['nodes'])->toBeInstanceOf(stdClass::class);

    Plan::factory()->fromFixture('no-such-plan')->create();
})->throws(InvalidArgumentException::class);

it('creates numbered revisions and points the plan at the latest', function (): void {
    $plan = Plan::factory()->withRevisions(3)->create()->fresh();

    expect($plan->revisions()->orderBy('number')->pluck('number')->all())->toBe([1, 2, 3])
        ->and($plan->currentRevision->number)->toBe(3)
        ->and($plan->currentRevision->document)->toEqual($plan->working_document);
});

it('creates revisions for every reason', function (): void {
    $plan = Plan::factory()->create();

    $cases = [
        [PlanRevisionReason::ManualCheckpoint, PlanRevision::factory()->manualCheckpoint()],
        [PlanRevisionReason::ImportAccepted, PlanRevision::factory()->importAccepted()],
        [PlanRevisionReason::BeforeRestore, PlanRevision::factory()->beforeRestore()],
        [PlanRevisionReason::StaffEdit, PlanRevision::factory()->staffEdit()],
        [PlanRevisionReason::AutoDaily, PlanRevision::factory()->autoDaily()],
    ];

    foreach ($cases as $index => [$reason, $factory]) {
        $revision = $factory->for($plan)->state(['number' => $index + 1])->create()->fresh();

        expect($revision->reason)->toBe($reason);
    }

    $generic = PlanRevision::factory()->reason(PlanRevisionReason::StaffEdit)->make();
    expect($generic->reason)->toBe(PlanRevisionReason::StaffEdit);
});

it('defaults a revision to a manual checkpoint of the plan with no updated_at', function (): void {
    $revision = PlanRevision::factory()->create()->fresh();

    expect($revision->reason)->toBe(PlanRevisionReason::ManualCheckpoint)
        ->and($revision->number)->toBe(1)
        ->and($revision->schema_version)->toBe(1)
        ->and($revision->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($revision->getAttributes())->not->toHaveKey('updated_at')
        ->and($revision->plan)->toBeInstanceOf(Plan::class)
        ->and($revision->label)->toBeNull();
});

it('refuses to update a revision', function (): void {
    PlanRevision::factory()->create()->update(['label' => 'x']);
})->throws(LogicException::class);

it('refuses to save a changed revision', function (): void {
    $revision = PlanRevision::factory()->create();
    $revision->document = Documents::emptyPlan(['createdWith' => 'import']);

    $revision->save();
})->throws(LogicException::class);

it('enforces unique (plan_id, number)', function (): void {
    $plan = Plan::factory()->create();
    PlanRevision::factory()->for($plan)->create(['number' => 1]);

    PlanRevision::factory()->for($plan)->create(['number' => 1]);
})->throws(QueryException::class);

it('allows the same number on different plans', function (): void {
    PlanRevision::factory()->count(2)->create(['number' => 1]);

    expect(PlanRevision::query()->count())->toBe(2);
});

it('cascades from project to plans to revisions', function (): void {
    $plan = Plan::factory()->withRevisions(2)->create();
    $project = $plan->project;

    $project->forceDelete();

    expect(Plan::withTrashed()->count())->toBe(0)
        ->and(PlanRevision::query()->count())->toBe(0);
});

it('keeps plans and revisions on a soft-deleted project', function (): void {
    $plan = Plan::factory()->withRevisions(1)->create();

    $plan->project->delete();

    expect(Project::withTrashed()->count())->toBe(1)
        ->and(Plan::query()->count())->toBe(1)
        ->and(PlanRevision::query()->count())->toBe(1);
});

it('refuses to delete an owner who still has projects', function (): void {
    $project = Project::factory()->create();

    $project->owner->forceDelete();
})->throws(QueryException::class);

it('nulls created_by, site address, saver and locker when those rows are removed', function (): void {
    $staff = User::factory()->staff()->create();
    $project = Project::factory()->createdByStaff($staff)->withSiteAddress()->create();
    $plan = Plan::factory()->for($project)->locked($staff)->create();
    DB::table('plans')->where('id', $plan->id)->update(['working_saved_by' => $staff->id]);
    $revision = PlanRevision::factory()->for($plan)->create(['author_id' => $staff->id]);

    $project->siteAddress->delete();
    $staff->forceDelete();

    expect($project->fresh()->created_by)->toBeNull()
        ->and($project->fresh()->site_address_id)->toBeNull()
        ->and($plan->fresh()->locked_by)->toBeNull()
        ->and($plan->fresh()->working_saved_by)->toBeNull()
        ->and($revision->fresh()->author_id)->toBeNull();
});

it('nulls plans.current_revision_id when that revision is deleted', function (): void {
    $plan = Plan::factory()->withRevisions(2)->create();
    $current = $plan->fresh()->currentRevision;

    $current->delete();

    expect($plan->fresh()->current_revision_id)->toBeNull()
        ->and($plan->revisions()->count())->toBe(1);
});

it('gives a default withSiteAddress project an address of its own owner', function (): void {
    $project = Project::factory()->withSiteAddress()->create()->fresh();

    expect($project->siteAddress->user_id)->toBe($project->owner_id)
        ->and(User::query()->count())->toBe(1);
});

it('resolves project relations and states', function (): void {
    $owner = User::factory()->create();
    $project = Project::factory()->forCustomer($owner)->withSiteAddress()->create()->fresh();
    $staff = User::factory()->staff()->create();
    $byStaff = Project::factory()->forCustomer($owner)->createdByStaff($staff)->create()->fresh();
    Plan::factory()->for($project)->create(['level_index' => 1]);
    Plan::factory()->for($project)->create(['level_index' => 0]);

    expect($project->owner->is($owner))->toBeTrue()
        ->and($project->createdBy->is($owner))->toBeTrue()
        ->and($project->siteAddress)->toBeInstanceOf(Address::class)
        ->and($project->siteAddress->user_id)->toBe($owner->id)
        ->and($byStaff->createdBy->is($staff))->toBeTrue()
        ->and($byStaff->owner->is($owner))->toBeTrue()
        ->and($project->plans)->toHaveCount(2)
        ->and($owner->projects)->toHaveCount(2)
        ->and(Project::factory()->archived()->create()->status)->toBe(ProjectStatus::Archived);
});

it('registers the morph aliases', function (): void {
    expect((new Project)->getMorphClass())->toBe('project')
        ->and((new Plan)->getMorphClass())->toBe('plan')
        ->and((new PlanRevision)->getMorphClass())->toBe('plan_revision');
});

it('declares the media collections of 02 §10', function (): void {
    $project = new Project;
    $project->registerMediaCollections();
    $plan = new Plan;
    $plan->registerMediaCollections();

    $cover = collect($project->mediaCollections)->firstWhere('name', 'cover');
    $thumbnail = collect($plan->mediaCollections)->firstWhere('name', 'thumbnail');

    expect($cover->diskName)->toBe('s3-public')
        ->and($cover->singleFile)->toBeTrue()
        ->and($thumbnail->diskName)->toBe('s3')
        ->and($thumbnail->singleFile)->toBeTrue();
});

it('attaches a thumbnail to a plan', function (): void {
    $plan = Plan::factory()->withThumbnail()->create();

    expect($plan->getFirstMedia('thumbnail'))->not->toBeNull()
        ->and($plan->getFirstMedia('thumbnail')->disk)->toBe('s3')
        ->and($plan->getFirstMedia('thumbnail')->model_id)->toBe($plan->id);
});
