<?php

declare(strict_types=1);

namespace App\Domain\Projects\Models;

use App\Domain\Identity\Models\User;
use App\Domain\Projects\Enums\PlanRevisionReason;
use App\Support\Casts\AsJsonDocument;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Projects\PlanRevisionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * 02 §3.3: an immutable snapshot of a plan document. Rows are created once; any update throws.
 *
 * @property string $id
 * @property string $plan_id
 * @property int $number
 * @property array<array-key, mixed> $document
 * @property int $schema_version
 * @property PlanRevisionReason $reason
 * @property string|null $label
 * @property string|null $author_id
 * @property CarbonImmutable|null $created_at
 */
#[Fillable(['plan_id', 'number', 'document', 'schema_version', 'reason', 'label', 'author_id'])]
final class PlanRevision extends Model
{
    /** @use HasFactory<PlanRevisionFactory> */
    use HasFactory, HasUlids;

    public const ?string UPDATED_AT = null;

    protected static function booted(): void
    {
        self::updating(static function (self $revision): never {
            throw new LogicException("Plan revision {$revision->getKey()} is immutable and cannot be updated.");
        });
    }

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'document' => AsJsonDocument::class,
            'reason' => PlanRevisionReason::class,
            'created_at' => 'immutable_datetime',
        ];
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
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    protected static function newFactory(): PlanRevisionFactory
    {
        return PlanRevisionFactory::new();
    }
}
