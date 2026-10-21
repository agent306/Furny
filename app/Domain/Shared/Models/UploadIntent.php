<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Shared\UploadIntentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * 02 §1.6: one row per presigned browser upload (13 §11). `status` is moved only by the upload
 * actions and the processing job, never mass-assigned from a request.
 *
 * @property string $id
 * @property string $user_id
 * @property UploadPurpose $purpose
 * @property string|null $target_type
 * @property string|null $target_id
 * @property string $object_key
 * @property string|null $processed_key
 * @property string $original_filename
 * @property string $declared_mime
 * @property int $declared_size
 * @property string|null $sniffed_mime
 * @property int|null $width
 * @property int|null $height
 * @property UploadStatus $status
 * @property string|null $reason_code
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $consumed_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable([
    'user_id', 'purpose', 'target_type', 'target_id', 'object_key', 'processed_key', 'original_filename',
    'declared_mime', 'declared_size', 'sniffed_mime', 'width', 'height', 'status', 'reason_code',
    'expires_at', 'consumed_at',
])]
final class UploadIntent extends Model
{
    /** @use HasFactory<UploadIntentFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purpose' => UploadPurpose::class,
            'status' => UploadStatus::class,
            'declared_size' => 'int',
            'width' => 'int',
            'height' => 'int',
            'expires_at' => 'immutable_datetime',
            'consumed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The model the upload was authorised against (morph alias in `target_type`).
     *
     * @return MorphTo<Model, $this>
     */
    public function target(): MorphTo
    {
        return $this->morphTo('target', 'target_type', 'target_id');
    }

    protected static function newFactory(): UploadIntentFactory
    {
        return UploadIntentFactory::new();
    }
}
