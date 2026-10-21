<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Models;

use App\Domain\Furniture\Enums\AuthorKind;
use App\Domain\Furniture\Enums\BomStatus;
use App\Domain\Furniture\Enums\FurnitureRevisionReason;
use App\Domain\Identity\Models\User;
use App\Support\Casts\AsJsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Furniture\FurnitureRevisionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;

/**
 * 02 §5.2: an immutable snapshot of a furniture document. Rows are created once. The only columns
 * that may change afterwards are the server-computed BOM result (`ComputeRevisionBom` and the
 * staleness refresh of 08 §6 write them, 03 §3.5); any other update throws.
 *
 * @property string $id
 * @property string $furniture_design_id
 * @property int $number
 * @property array<array-key, mixed> $document
 * @property int $schema_version
 * @property array<string, mixed>|null $bom
 * @property array<string, mixed>|null $price
 * @property BomStatus $bom_status
 * @property string|null $engine_version
 * @property int|null $catalog_version
 * @property FurnitureRevisionReason $reason
 * @property string|null $author_id
 * @property AuthorKind $author_kind
 * @property list<array<string, mixed>>|null $change_summary
 * @property CarbonImmutable|null $created_at
 */
#[Fillable([
    'furniture_design_id', 'number', 'document', 'schema_version', 'bom', 'price', 'bom_status', 'engine_version',
    'catalog_version', 'reason', 'author_id', 'author_kind', 'change_summary',
])]
final class FurnitureRevision extends Model implements HasMedia
{
    /** @use HasFactory<FurnitureRevisionFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    public const ?string UPDATED_AT = null;

    /** Written after creation by the BOM job (the only mutable columns). */
    private const array BOM_RESULT_COLUMNS = ['bom', 'price', 'bom_status', 'engine_version', 'catalog_version'];

    protected static function booted(): void
    {
        self::updating(static function (self $revision): void {
            $frozen = array_diff(array_keys($revision->getDirty()), self::BOM_RESULT_COLUMNS);

            if ($frozen !== []) {
                throw new LogicException(sprintf(
                    'Furniture revision %s is immutable; only the BOM result may change (tried: %s).',
                    $revision->getKey(),
                    implode(', ', $frozen),
                ));
            }
        });
    }

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'document' => AsJsonDocument::class,
            'bom' => 'array',
            'price' => 'array',
            'bom_status' => BomStatus::class,
            'reason' => FurnitureRevisionReason::class,
            'author_kind' => AuthorKind::class,
            'change_summary' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<FurnitureDesign, $this>
     */
    public function furnitureDesign(): BelongsTo
    {
        return $this->belongsTo(FurnitureDesign::class, 'furniture_design_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /** 02 §10: one cut-list PDF on the private disk, rendered by `RenderCutListPdf` (08 §8.2). */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('cutlist_pdf')
            ->useDisk('s3')
            ->singleFile()
            ->acceptsMimeTypes(['application/pdf']);
    }

    protected static function newFactory(): FurnitureRevisionFactory
    {
        return FurnitureRevisionFactory::new();
    }
}
