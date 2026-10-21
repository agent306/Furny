<?php

declare(strict_types=1);

namespace App\Domain\Ai\Models;

use App\Domain\Ai\Enums\AiFeature;
use App\Domain\Ai\Enums\AiProvider;
use App\Domain\Ai\Enums\AiUsageStatus;
use App\Domain\Identity\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Ai\AiUsageEventFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * 02 §7.2: one metered AI run (or provider test), written by the run itself once it ends (18 §13.1).
 * Nothing is mass-assignable.
 *
 * @property string $id
 * @property string|null $user_id
 * @property AiFeature $feature
 * @property AiProvider $provider
 * @property string|null $model
 * @property int $request_count
 * @property int $input_tokens
 * @property int $output_tokens
 * @property int $image_count
 * @property int $cost_micro_usd
 * @property int $duration_ms
 * @property AiUsageStatus $status
 * @property string|null $reference_type
 * @property string|null $reference_id
 * @property CarbonImmutable|null $created_at
 */
final class AiUsageEvent extends Model
{
    /** @use HasFactory<AiUsageEventFactory> */
    use HasFactory, HasUlids;

    public const ?string UPDATED_AT = null;

    /**
     * @return array<string, string|class-string>
     */
    protected function casts(): array
    {
        return [
            'feature' => AiFeature::class,
            'provider' => AiProvider::class,
            'request_count' => 'integer',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'image_count' => 'integer',
            'cost_micro_usd' => 'integer',
            'duration_ms' => 'integer',
            'status' => AiUsageStatus::class,
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * Null once the user's account is deleted.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The BlueprintImport the run was for; null for `provider_test`.
     *
     * @return MorphTo<Model, $this>
     */
    public function reference(): MorphTo
    {
        return $this->morphTo();
    }

    protected static function newFactory(): AiUsageEventFactory
    {
        return AiUsageEventFactory::new();
    }
}
