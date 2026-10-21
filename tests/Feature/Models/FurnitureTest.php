<?php

declare(strict_types=1);

use App\Domain\Furniture\Enums\AuthorKind;
use App\Domain\Furniture\Enums\BomStatus;
use App\Domain\Furniture\Enums\FurnitureRevisionReason;
use App\Domain\Furniture\Enums\PresetCategory;
use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurniturePreset;
use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Furniture\Models\FurnitureTemplateSetting;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Project;
use App\Support\Json\JsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Support\Documents;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * 02 §5, §10, §11 and 03 §2.
 */
it('has the backed enum values of 02 §5', function (): void {
    $values = static fn (string $enum): array => array_map(static fn (BackedEnum $case): string|int => $case->value, $enum::cases());

    expect($values(PresetCategory::class))->toBe(['wardrobe', 'kitchen', 'storage', 'shelving', 'tv_unit', 'table', 'desk', 'bed', 'other'])
        ->and($values(BomStatus::class))->toBe(['pending', 'ready', 'failed'])
        ->and($values(FurnitureRevisionReason::class))->toBe(['manual_checkpoint', 'order_submitted', 'staff_proposal', 'proposal_applied', 'before_restore'])
        ->and($values(AuthorKind::class))->toBe(['customer', 'staff']);
});

it('builds the structural furniture placeholder of 03 §2', function (): void {
    $doc = Documents::placeholderFurniture();

    expect(array_keys($doc))->toBe(['schemaVersion', 'templateKey', 'family', 'dims', 'materials', 'carcass', 'table', 'overrides', 'notes'])
        ->and($doc['schemaVersion'])->toBe(1)
        ->and($doc['templateKey'])->toBe('wardrobe')
        ->and($doc['family'])->toBe('carcass')
        ->and($doc['dims'])->toBe(['width' => 1800, 'height' => 2100, 'depth' => 600])
        ->and(array_keys($doc['materials']))->toBe(['carcass', 'back', 'shelf', 'front', 'top', 'drawer_box', 'drawer_bottom', 'plinth', 'leg'])
        ->and($doc['materials']['carcass'])->toBe(['materialCode' => 'PB18-WHITE', 'edgeBandCode' => 'EB08-WHITE', 'finishCode' => null])
        ->and($doc['table'])->toBeNull()
        ->and(Documents::placeholderFurniture('bookshelf')['templateKey'])->toBe('bookshelf')
        ->and(JsonDocument::encode($doc))->toContain('"overrides":{"parts":{},"extraParts":[],"hardware":{},"extraHardware":[]}');
});

it('references only seeded material and edge band codes in the placeholder', function (): void {
    $catalog = require database_path('seeders/data/catalog.php');
    $materials = array_column($catalog['materials'], 'code');
    $edgeBands = array_column($catalog['edge_bands'], 'code');

    foreach (Documents::placeholderFurniture()['materials'] as $role => $assignment) {
        expect($materials)->toContain($assignment['materialCode']);

        if ($assignment['edgeBandCode'] !== null) {
            expect($edgeBands)->toContain($assignment['edgeBandCode']);
        }
    }
});

it('creates a design owned by the project owner with denormalised dimensions', function (): void {
    $design = FurnitureDesign::factory()->create()->fresh();

    expect($design->owner_id)->toBe($design->project->owner_id)
        ->and($design->created_by)->toBe($design->owner_id)
        ->and($design->template_key)->toBe('wardrobe')
        ->and($design->working_version)->toBe(1)
        ->and([$design->width_mm, $design->height_mm, $design->depth_mm])->toBe([1800, 2100, 600])
        ->and($design->estimate)->toBe([])
        ->and(DB::table('furniture_designs')->where('id', $design->id)->value('estimate'))->toBe('{}')
        ->and($design->working_document['overrides']['parts'])->toBeInstanceOf(stdClass::class)
        ->and($design->preset_id)->toBeNull()
        ->and($design->isLocked())->toBeFalse()
        ->and($design->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and(User::query()->count())->toBe(1);
});

it('lets the design follow an explicit project through for()', function (): void {
    $project = Project::factory()->create();
    $design = FurnitureDesign::factory()->for($project)->create();

    expect($design->owner_id)->toBe($project->owner_id)
        ->and($project->furnitureDesigns)->toHaveCount(1)
        ->and($design->project->is($project))->toBeTrue();
});

it('detects a locked design through locked_by_order_id', function (): void {
    $design = FurnitureDesign::factory()->create();
    DB::table('furniture_designs')->where('id', $design->id)->update(['locked_by_order_id' => Order::factory()->create()->id]);

    expect($design->fresh()->isLocked())->toBeTrue();
});

it('stores an estimate and marks it stale', function (): void {
    $fresh = FurnitureDesign::factory()->withEstimate()->create()->fresh();
    $stale = FurnitureDesign::factory()->staleEstimate()->create()->fresh();

    expect($fresh->estimate)->toHaveKeys(['totalMinor', 'currency', 'partCount', 'sheetCount', 'catalogVersion', 'engineVersion', 'computedAt'])
        ->and($stale->estimate['catalogVersion'])->toBeLessThan($fresh->estimate['catalogVersion']);
});

it('creates numbered revisions and points the design at the latest', function (): void {
    $design = FurnitureDesign::factory()->withRevisions(3)->create()->fresh();

    expect($design->revisions()->orderBy('number')->pluck('number')->all())->toBe([1, 2, 3])
        ->and($design->currentRevision->number)->toBe(3)
        ->and($design->currentRevision->document)->toEqual($design->working_document);
});

it('defaults a revision to a pending customer checkpoint with no updated_at', function (): void {
    $revision = FurnitureRevision::factory()->create()->fresh();

    expect($revision->reason)->toBe(FurnitureRevisionReason::ManualCheckpoint)
        ->and($revision->bom_status)->toBe(BomStatus::Pending)
        ->and($revision->author_kind)->toBe(AuthorKind::Customer)
        ->and($revision->number)->toBe(1)
        ->and($revision->schema_version)->toBe(1)
        ->and($revision->bom)->toBeNull()
        ->and($revision->price)->toBeNull()
        ->and($revision->change_summary)->toBeNull()
        ->and($revision->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($revision->getAttributes())->not->toHaveKey('updated_at')
        ->and($revision->furnitureDesign)->toBeInstanceOf(FurnitureDesign::class);
});

it('builds revision states for every reason and bom status', function (): void {
    $design = FurnitureDesign::factory()->create();
    $cases = [
        [FurnitureRevisionReason::OrderSubmitted, FurnitureRevision::factory()->orderSubmitted()],
        [FurnitureRevisionReason::StaffProposal, FurnitureRevision::factory()->staffProposal()],
        [FurnitureRevisionReason::ProposalApplied, FurnitureRevision::factory()->proposalApplied()],
        [FurnitureRevisionReason::ManualCheckpoint, FurnitureRevision::factory()->manualCheckpoint()],
        [FurnitureRevisionReason::BeforeRestore, FurnitureRevision::factory()->beforeRestore()],
    ];

    foreach ($cases as $index => [$reason, $factory]) {
        $revision = $factory->for($design)->state(['number' => $index + 1])->create()->fresh();

        expect($revision->reason)->toBe($reason);
    }

    $staff = FurnitureRevision::factory()->staffProposal()->create(['number' => 9, 'furniture_design_id' => $design->id])->fresh();
    $ready = FurnitureRevision::factory()->bomReady()->create()->fresh();
    $failed = FurnitureRevision::factory()->bomFailed()->create()->fresh();
    $pending = FurnitureRevision::factory()->bomPending()->create()->fresh();

    expect($staff->author_kind)->toBe(AuthorKind::Staff)
        ->and($ready->bom_status)->toBe(BomStatus::Ready)
        ->and($ready->bom)->toHaveKeys(['engineVersion', 'catalogVersion', 'cutList', 'materials'])
        ->and($ready->price)->toHaveKeys(['currency', 'lines', 'unitPriceMinor'])
        ->and($ready->engine_version)->not->toBeNull()
        ->and($ready->catalog_version)->not->toBeNull()
        ->and($failed->bom_status)->toBe(BomStatus::Failed)
        ->and($failed->bom)->toBeNull()
        ->and($pending->bom_status)->toBe(BomStatus::Pending);
});

it('marks revisions computed against an older catalog or engine as stale', function (): void {
    $catalog = FurnitureRevision::factory()->staleCatalog()->create()->fresh();
    $engine = FurnitureRevision::factory()->staleEngine()->create()->fresh();
    $current = FurnitureRevision::factory()->bomReady()->create()->fresh();

    expect($catalog->bom_status)->toBe(BomStatus::Ready)
        ->and($catalog->catalog_version)->toBeLessThan($current->catalog_version)
        ->and($catalog->engine_version)->toBe($current->engine_version)
        ->and($engine->bom_status)->toBe(BomStatus::Ready)
        ->and($engine->engine_version)->not->toBe($current->engine_version)
        ->and($engine->catalog_version)->toBe($current->catalog_version);
});

it('refuses to update a revision', function (): void {
    FurnitureRevision::factory()->create()->update(['reason' => FurnitureRevisionReason::BeforeRestore]);
})->throws(LogicException::class);

it('refuses to save a changed revision document', function (): void {
    $revision = FurnitureRevision::factory()->create();
    $revision->document = Documents::placeholderFurniture('bookshelf');

    $revision->save();
})->throws(LogicException::class);

it('lets an unchanged revision be saved without tripping the immutability guard', function (): void {
    $revision = FurnitureRevision::factory()->create()->fresh();

    $revision->document = $revision->document;

    expect($revision->save())->toBeTrue();
});

it('lets the bom job store its result on a pending revision and nothing else', function (): void {
    $revision = FurnitureRevision::factory()->bomPending()->create()->fresh();
    $computed = FurnitureRevision::factory()->bomReady()->make();

    $revision->forceFill([
        'bom' => $computed->bom,
        'price' => $computed->price,
        'bom_status' => BomStatus::Ready,
        'engine_version' => '1.0.0',
        'catalog_version' => 3,
    ])->save();

    expect($revision->fresh()->bom_status)->toBe(BomStatus::Ready)
        ->and($revision->fresh()->catalog_version)->toBe(3);

    $revision->forceFill(['bom_status' => BomStatus::Failed, 'number' => 7]);

    expect(fn () => $revision->save())->toThrow(LogicException::class);
});

it('enforces unique (furniture_design_id, number)', function (): void {
    $design = FurnitureDesign::factory()->create();
    FurnitureRevision::factory()->for($design)->create(['number' => 1]);

    FurnitureRevision::factory()->for($design)->create(['number' => 1]);
})->throws(QueryException::class);

it('allows the same revision number on different designs', function (): void {
    FurnitureRevision::factory()->count(2)->create(['number' => 1]);

    expect(FurnitureRevision::query()->count())->toBe(2);
});

it('cascades from project to designs to revisions', function (): void {
    $design = FurnitureDesign::factory()->withRevisions(2)->create();

    $design->project->forceDelete();

    expect(FurnitureDesign::withTrashed()->count())->toBe(0)
        ->and(FurnitureRevision::query()->count())->toBe(0);
});

it('keeps designs and revisions on a soft-deleted project', function (): void {
    $design = FurnitureDesign::factory()->withRevisions(1)->create();

    $design->project->delete();

    expect(Project::withTrashed()->count())->toBe(1)
        ->and(FurnitureDesign::query()->count())->toBe(1)
        ->and(FurnitureRevision::query()->count())->toBe(1);
});

it('refuses to delete an owner who still has designs', function (): void {
    $other = User::factory()->create();
    FurnitureDesign::factory()->create(['owner_id' => $other->id]);

    $other->forceDelete();
})->throws(QueryException::class);

it('nulls preset_id when the preset is deleted', function (): void {
    $preset = FurniturePreset::factory()->create();
    $design = FurnitureDesign::factory()->create(['preset_id' => $preset->id]);

    expect($design->fresh()->preset->is($preset))->toBeTrue();

    $preset->forceDelete();

    expect($design->fresh()->preset_id)->toBeNull();
});

it('nulls author, saver, creator and current revision links when those rows go', function (): void {
    $staff = User::factory()->staff()->create();
    $design = FurnitureDesign::factory()->withRevisions(2)->create(['created_by' => $staff->id]);
    DB::table('furniture_designs')->where('id', $design->id)->update(['working_saved_by' => $staff->id]);
    $revision = FurnitureRevision::factory()->for($design)->staffProposal()->create(['number' => 3, 'author_id' => $staff->id]);
    $preset = FurniturePreset::factory()->create(['created_by' => $staff->id]);

    $staff->forceDelete();

    expect($design->fresh()->created_by)->toBeNull()
        ->and($design->fresh()->working_saved_by)->toBeNull()
        ->and($revision->fresh()->author_id)->toBeNull()
        ->and($preset->fresh()->created_by)->toBeNull();

    $design->fresh()->currentRevision->delete();

    expect($design->fresh()->current_revision_id)->toBeNull();
});

it('soft-deletes designs and presets', function (): void {
    $design = FurnitureDesign::factory()->create();
    $preset = FurniturePreset::factory()->create();

    $design->delete();
    $preset->delete();

    expect(FurnitureDesign::query()->count())->toBe(0)
        ->and(FurnitureDesign::withTrashed()->count())->toBe(1)
        ->and(FurniturePreset::query()->count())->toBe(0)
        ->and(FurniturePreset::withTrashed()->count())->toBe(1);
});

it('creates presets with a unique slug and valid defaults', function (): void {
    $preset = FurniturePreset::factory()->create()->fresh();

    expect($preset->category)->toBe(PresetCategory::Wardrobe)
        ->and($preset->is_active)->toBeTrue()
        ->and($preset->sort_order)->toBe(0)
        ->and($preset->slug)->not->toBe('')
        ->and($preset->document['schemaVersion'])->toBe(1)
        ->and(FurniturePreset::factory()->inactive()->create()->is_active)->toBeFalse()
        ->and(FurniturePreset::factory()->category(PresetCategory::Desk)->create()->category)->toBe(PresetCategory::Desk);

    FurniturePreset::factory()->create(['slug' => $preset->slug]);
})->throws(QueryException::class);

it('creates template settings keyed by template_key', function (): void {
    $setting = FurnitureTemplateSetting::factory()->create(['template_key' => 'wardrobe_hinged'])->fresh();

    expect($setting->getKey())->toBe('wardrobe_hinged')
        ->and($setting->is_enabled)->toBeTrue()
        ->and($setting->sort_order)->toBe(0)
        ->and($setting->default_overrides)->toBe([])
        ->and(DB::table('furniture_template_settings')->value('default_overrides'))->toBe('{}')
        ->and(FurnitureTemplateSetting::factory()->disabled()->create()->is_enabled)->toBeFalse()
        ->and(FurnitureTemplateSetting::factory()->withDefaultOverrides(['width' => 2000])->create()->fresh()->default_overrides)->toBe(['width' => 2000]);

    FurnitureTemplateSetting::factory()->create(['template_key' => 'wardrobe_hinged']);
})->throws(QueryException::class);

it('keeps an empty map as {} when a design estimate is cleared', function (): void {
    $design = FurnitureDesign::factory()->withEstimate()->create();

    $design->estimate = [];
    $design->save();

    expect(DB::table('furniture_designs')->where('id', $design->id)->value('estimate'))->toBe('{}');
});

it('registers the morph aliases', function (): void {
    expect((new FurnitureDesign)->getMorphClass())->toBe('furniture_design')
        ->and((new FurnitureRevision)->getMorphClass())->toBe('furniture_revision')
        ->and((new FurniturePreset)->getMorphClass())->toBe('furniture_preset')
        ->and((new FurnitureTemplateSetting)->getMorphClass())->toBe('furniture_template_setting');
});

it('declares the media collections of 02 §10', function (): void {
    $collection = static function (object $model, string $name): object {
        $model->registerMediaCollections();

        return collect($model->mediaCollections)->firstWhere('name', $name);
    };

    $designThumbnail = $collection(new FurnitureDesign, 'thumbnail');
    $cutlist = $collection(new FurnitureRevision, 'cutlist_pdf');
    $presetThumbnail = $collection(new FurniturePreset, 'thumbnail');

    expect($designThumbnail->diskName)->toBe('s3')
        ->and($designThumbnail->singleFile)->toBeTrue()
        ->and($cutlist->diskName)->toBe('s3')
        ->and($cutlist->singleFile)->toBeTrue()
        ->and($presetThumbnail->diskName)->toBe('s3-public')
        ->and($presetThumbnail->singleFile)->toBeTrue();
});

it('registers a 320 px wide small conversion on design and preset thumbnails', function (): void {
    foreach ([FurnitureDesign::class, FurniturePreset::class] as $class) {
        $model = new $class;
        $model->registerMediaConversions();

        $small = collect($model->mediaConversions)->first(static fn ($conversion): bool => $conversion->getName() === 'small');

        expect($small)->not->toBeNull()
            ->and($small->shouldBePerformedOn('thumbnail'))->toBeTrue()
            ->and($small->shouldBePerformedOn('other'))->toBeFalse()
            ->and($small->getManipulations()->toArray()['width'])->toBe([320]);
    }
});

it('attaches thumbnails and a cut list pdf', function (): void {
    $design = FurnitureDesign::factory()->withThumbnail()->create();
    $preset = FurniturePreset::factory()->withThumbnail()->create();

    expect($design->getFirstMedia('thumbnail')->disk)->toBe('s3')
        ->and($design->getFirstMedia('thumbnail')->model_id)->toBe($design->id)
        ->and($preset->getFirstMedia('thumbnail')->disk)->toBe('s3-public');

    $revision = FurnitureRevision::factory()->create();
    $revision->addMediaFromString("%PDF-1.4\n%%EOF")->usingFileName('cutlist.pdf')->toMediaCollection('cutlist_pdf');

    expect($revision->getFirstMedia('cutlist_pdf')->disk)->toBe('s3');
});

it('does not mark an identical map dirty but notices a real change', function (): void {
    $design = FurnitureDesign::factory()->withEstimate()->create()->fresh();
    $estimate = $design->estimate;

    $design->estimate = $estimate;
    expect($design->isDirty('estimate'))->toBeFalse();

    $design->estimate = array_reverse($estimate, true);
    expect($design->isDirty('estimate'))->toBeFalse();

    $design->estimate = JsonDocument::encode($estimate);
    expect($design->isDirty('estimate'))->toBeFalse();

    $estimate['totalMinor']++;
    $design->estimate = $estimate;
    expect($design->isDirty('estimate'))->toBeTrue();
});
