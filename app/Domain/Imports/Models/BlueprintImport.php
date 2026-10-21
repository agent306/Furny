<?php

declare(strict_types=1);

namespace App\Domain\Imports\Models;

use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Enums\ImportSourceKind;
use App\Domain\Imports\Enums\ImportStatus;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Support\Casts\AsJsonDocument;
use App\Support\Casts\AsJsonMap;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Imports\BlueprintImportFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * 02 §4.1 / 06 §4.2. Only the upload description and the user's hints are mass-assignable; status,
 * target plan, provider snapshot, credits, results, errors and run stamps are written by the
 * import actions and jobs (transitions are guarded there, 06 §3).
 *
 * @property string $id
 * @property string $project_id
 * @property string|null $plan_id
 * @property string $user_id
 * @property ImportStatus $status
 * @property ImportMode $mode
 * @property ImportSourceKind|null $source_kind
 * @property string $original_filename
 * @property string|null $mime_type
 * @property int|null $file_size_bytes
 * @property int|null $page_count
 * @property int $selected_page
 * @property array<string, mixed> $hints
 * @property AiProvider|null $ai_provider
 * @property string|null $ai_model
 * @property int $credits_reserved
 * @property int $credits_charged
 * @property array<array-key, mixed>|null $result_document
 * @property array<string, mixed>|null $result_meta
 * @property int $review_version
 * @property string|null $error_code
 * @property string|null $error_message
 * @property int $attempts
 * @property CarbonImmutable|null $started_at
 * @property CarbonImmutable|null $finished_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['user_id', 'mode', 'original_filename', 'mime_type', 'file_size_bytes', 'selected_page', 'hints'])]
final class BlueprintImport extends Model implements HasMedia
{
    /** @use HasFactory<BlueprintImportFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'status' => ImportStatus::class,
            'mode' => ImportMode::class,
            'source_kind' => ImportSourceKind::class,
            'ai_provider' => AiProvider::class,
            'hints' => AsJsonMap::class,
            'result_document' => AsJsonDocument::class,
            'result_meta' => 'array',
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
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
     * @return BelongsTo<Plan, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** No further transition happens: accepted, discarded, failed or cancelled (06 §3). */
    public function isTerminal(): bool
    {
        return in_array($this->status, [
            ImportStatus::Accepted,
            ImportStatus::Discarded,
            ImportStatus::Failed,
            ImportStatus::Cancelled,
        ], true);
    }

    /** The recognition run is in flight or waiting for a worker (cancel is only allowed before it starts). */
    public function isActiveRun(): bool
    {
        return in_array($this->status, [
            ImportStatus::Queued,
            ImportStatus::Preprocessing,
            ImportStatus::Recognizing,
        ], true);
    }

    /**
     * 02 §10. `source` takes the declared MIME types of 06 §2.1; the sniffed type has already been
     * validated by `ProcessUpload` (13 §11.3), so this list only keeps unrelated files out.
     */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('source')
            ->useDisk('s3')
            ->singleFile()
            ->acceptsMimeTypes([
                'image/jpeg', 'image/png', 'image/webp',
                'image/heic', 'image/heif',
                'application/pdf',
                'image/vnd.dxf', 'application/dxf', 'application/x-dxf', 'image/x-dxf', 'text/plain',
                'application/octet-stream',
            ]);

        $this->addMediaCollection('normalized')
            ->useDisk('s3')
            ->singleFile()
            ->acceptsMimeTypes(['image/png']);

        $this->addMediaCollection('debug')
            ->useDisk('s3')
            ->acceptsMimeTypes(['image/png', 'application/json']);

        $this->addMediaCollection('pages')
            ->useDisk('s3')
            ->acceptsMimeTypes(['image/webp', 'image/jpeg']);
    }

    /** `preview`: a 1600 px wide WebP of the normalized page, generated on the queue (06 §4.2). */
    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('preview')
            ->queued()
            ->performOnCollections('normalized')
            ->width(1600)
            ->format('webp');
    }

    protected static function newFactory(): BlueprintImportFactory
    {
        return BlueprintImportFactory::new();
    }
}
