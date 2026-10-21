<?php

declare(strict_types=1);

use App\Domain\Catalog\Enums\BoardType;
use App\Domain\Catalog\Enums\FinishType;
use App\Domain\Catalog\Enums\HardwareCategory;
use App\Domain\Catalog\Enums\HardwareUnit;
use App\Domain\Catalog\Enums\LabourUnit;
use App\Domain\Catalog\Enums\MaterialSurface;
use App\Domain\Catalog\Models\EdgeBand;
use App\Domain\Catalog\Models\Finish;
use App\Domain\Catalog\Models\HardwareItem;
use App\Domain\Catalog\Models\LabourRate;
use App\Domain\Catalog\Models\Material;
use App\Domain\Catalog\Models\TaxRate;
use App\Support\MorphMap;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Spatie\MediaLibrary\Conversions\Conversion;
use Spatie\MediaLibrary\Conversions\ConversionCollection;

it('has the enum values of 02 §6', function (): void {
    expect(array_column(BoardType::cases(), 'value'))->toBe([
        'particle_board', 'mdf', 'hdf', 'plywood', 'blockboard', 'solid_wood', 'glass', 'acrylic', 'metal_sheet',
    ])
        ->and(array_column(MaterialSurface::cases(), 'value'))->toBe([
            'raw', 'melamine', 'laminate', 'veneer', 'painted', 'lacquered', 'pre_laminated',
        ])
        ->and(HardwareCategory::cases())->toHaveCount(21)
        ->and(array_column(HardwareCategory::cases(), 'value'))->toContain('hinge', 'drawer_slide', 'led_strip', 'other')
        ->and(array_column(HardwareUnit::cases(), 'value'))->toBe(['piece', 'pair', 'set', 'meter', 'pack'])
        ->and(array_column(FinishType::cases(), 'value'))->toBe([
            'none', 'laminate', 'veneer', 'paint', 'pu', 'lacquer', 'duco', 'membrane',
        ])
        ->and(array_column(LabourUnit::cases(), 'value'))->toBe(['sheet', 'meter', 'part', 'piece', 'item', 'sqm', 'hour']);
});

it('registers the six catalog aliases in the morph map', function (): void {
    expect(MorphMap::MAP)->toMatchArray([
        'material' => Material::class,
        'edge_band' => EdgeBand::class,
        'hardware_item' => HardwareItem::class,
        'finish' => Finish::class,
        'labour_rate' => LabourRate::class,
        'tax_rate' => TaxRate::class,
    ])
        ->and((new Material)->getMorphClass())->toBe('material');
});

it('casts materials with decimal strings, enums and arrays', function (): void {
    $material = Material::factory()->create(['thickness_mm' => 18, 'waste_factor' => 0.12])->fresh();

    expect($material->thickness_mm)->toBe('18.0')
        ->and($material->waste_factor)->toBe('0.120')
        ->and($material->board_type)->toBe(BoardType::ParticleBoard)
        ->and($material->surface)->toBe(MaterialSurface::Melamine)
        ->and($material->usage)->toBe(['carcass', 'shelf', 'front', 'back', 'top'])
        ->and($material->has_grain)->toBeFalse()
        ->and($material->created_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($material->id)->toHaveLength(26);
});

it('casts edge bands, finishes, labour rates and tax rates', function (): void {
    expect(EdgeBand::factory()->create(['thickness_mm' => 0.8])->fresh()->thickness_mm)->toBe('0.80')
        ->and(Finish::factory()->create()->fresh()->finish_type)->toBe(FinishType::Pu)
        ->and(Finish::factory()->create()->fresh()->applies_to)->toBe(['mdf'])
        ->and(LabourRate::factory()->create()->fresh()->unit)->toBe(LabourUnit::Hour)
        ->and(TaxRate::factory()->create()->fresh()->rate_bps)->toBe(1800);
});

it('soft deletes materials, edge bands, hardware items and finishes only', function (): void {
    foreach ([Material::class, EdgeBand::class, HardwareItem::class, Finish::class] as $model) {
        $row = $model::factory()->create();
        $row->delete();

        expect($model::query()->count())->toBe(0)
            ->and($model::withTrashed()->count())->toBe(1);
    }

    $labour = LabourRate::factory()->create();
    $labour->delete();

    expect(LabourRate::query()->count())->toBe(0)
        ->and(method_exists($labour, 'trashed'))->toBeFalse();
});

it('stores hardware specs as a JSON object even when empty', function (): void {
    $empty = HardwareItem::factory()->create(['specs' => []]);
    $full = HardwareItem::factory()->create(['specs' => ['crankMm' => 0, 'angle' => 9.5, 'softClose' => true]]);

    expect(DB::table('hardware_items')->where('id', $empty->id)->value('specs'))->toBe('{}')
        ->and($empty->fresh()->specs)->toBe([])
        ->and($full->fresh()->specs)->toEqual(['crankMm' => 0, 'angle' => 9.5, 'softClose' => true]);
});

it('registers the single-file texture collections on the public disk with a 256 px small conversion', function (): void {
    foreach ([Material::factory()->create(), Finish::factory()->create()] as $owner) {
        $media = $owner->addMedia(UploadedFile::fake()->image('wood.jpg', 600, 600))->toMediaCollection('texture');
        $collection = $owner->getMediaCollection('texture');

        expect($media->disk)->toBe('s3-public')
            ->and($collection->singleFile)->toBeTrue()
            ->and($collection->acceptsMimeTypes)->toBe(['image/jpeg', 'image/webp'])
            ->and(ConversionCollection::createForMedia($media)->map(fn (Conversion $c): string => $c->getName())->all())->toBe(['small'])
            ->and(json_encode(ConversionCollection::createForMedia($media)->first()->getManipulations()->toArray()))->toContain('256');
    }
});

it('registers the hardware image collection with a 256 px thumb conversion', function (): void {
    $item = HardwareItem::factory()->create();
    $media = $item->addMedia(UploadedFile::fake()->image('hinge.png', 600, 600))->toMediaCollection('image');
    $collection = $item->getMediaCollection('image');

    expect($media->disk)->toBe('s3-public')
        ->and($collection->singleFile)->toBeTrue()
        ->and($collection->acceptsMimeTypes)->toBe(['image/jpeg', 'image/png', 'image/webp'])
        ->and(ConversionCollection::createForMedia($media)->map(fn (Conversion $c): string => $c->getName())->all())->toBe(['thumb']);
});
