<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Project;
use App\Support\Casts\AsJsonDocument;
use App\Support\Casts\AsJsonMap;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Furniture\FurnitureDesignFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §5.1. `owner_id` (the project's customer), the optimistic-lock counter, save stamps, current
 * revision and the order lock are written only by the create, save, checkpoint and order actions,
 * so they are not mass-assignable.
 *
 * @property string $id
 * @property string $project_id
 * @property string $owner_id
 * @property string|null $created_by
 * @property string $name
 * @property string $template_key
 * @property string|null $preset_id
 * @property array<array-key, mixed> $working_document
 * @property int $working_version
 * @property string|null $working_saved_by
 * @property CarbonImmutable|null $working_saved_at
 * @property string|null $current_revision_id
 * @property string|null $locked_by_order_id
 * @property array<string, mixed> $estimate
 * @property int $width_mm
 * @property int $height_mm
 * @property int $depth_mm
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['name', 'template_key', 'preset_id', 'working_document', 'estimate', 'width_mm', 'height_mm', 'depth_mm', 'created_by'])]
final class FurnitureDesign extends Model implements HasMedia
{
    /** @use HasFactory<FurnitureDesignFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'working_document' => AsJsonDocument::class,
            'estimate' => AsJsonMap::class,
            'working_saved_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<FurniturePreset, $this>
     */
    public function preset(): BelongsTo
    {
        return $this->belongsTo(FurniturePreset::class);
    }

    /**
     * @return HasMany<FurnitureRevision, $this>
     */
    public function revisions(): HasMany
    {
        return $this->hasMany(FurnitureRevision::class);
    }

    /**
     * @return BelongsTo<FurnitureRevision, $this>
     */
    public function currentRevision(): BelongsTo
    {
        return $this->belongsTo(FurnitureRevision::class, 'current_revision_id');
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function lockedByOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'locked_by_order_id');
    }

    /** An order holds the design: the customer cannot edit it (09 §2). */
    public function isLocked(): bool
    {
        return $this->locked_by_order_id !== null;
    }

    /** 02 §10: one PNG thumbnail on the private disk with a 320 px wide `small` conversion. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('thumbnail')
            ->useDisk('s3')
            ->singleFile()
            ->acceptsMimeTypes(['image/png']);
    }

    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('small')
            ->performOnCollections('thumbnail')
            ->width(320);
    }

    protected static function newFactory(): FurnitureDesignFactory
    {
        return FurnitureDesignFactory::new();
    }
}
