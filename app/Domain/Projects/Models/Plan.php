<?php

declare(strict_types=1);

namespace App\Domain\Projects\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Projects\Enums\PlanSource;
use App\Support\Casts\AsJsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Projects\PlanFactory;
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
 * 02 §3.2. The version counter, save/lock stamps and the current revision are written only by the
 * save, checkpoint and lock actions, so they are not mass-assignable.
 *
 * @property string $id
 * @property string $project_id
 * @property string $name
 * @property int $level_index
 * @property PlanSource $source
 * @property array<array-key, mixed> $working_document
 * @property int $working_version
 * @property string|null $working_saved_by
 * @property CarbonImmutable|null $working_saved_at
 * @property string|null $current_revision_id
 * @property int $schema_version
 * @property array<array-key, mixed> $summary
 * @property CarbonImmutable|null $locked_at
 * @property string|null $locked_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['name', 'level_index', 'source', 'working_document', 'schema_version', 'summary'])]
final class Plan extends Model implements HasMedia
{
    /** @use HasFactory<PlanFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'source' => PlanSource::class,
            'working_document' => AsJsonDocument::class,
            'summary' => 'array',
            'working_saved_at' => 'immutable_datetime',
            'locked_at' => 'immutable_datetime',
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
     * @return HasMany<PlanRevision, $this>
     */
    public function revisions(): HasMany
    {
        return $this->hasMany(PlanRevision::class);
    }

    /**
     * @return BelongsTo<PlanRevision, $this>
     */
    public function currentRevision(): BelongsTo
    {
        return $this->belongsTo(PlanRevision::class, 'current_revision_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function lockedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'locked_by');
    }

    /** A locked plan is read-only for everyone (03 §5: working-copy saves answer 423 `plan_locked`). */
    public function isLocked(): bool
    {
        return $this->locked_at !== null;
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

    protected static function newFactory(): PlanFactory
    {
        return PlanFactory::new();
    }
}
