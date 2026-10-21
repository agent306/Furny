<?php

declare(strict_types=1);

namespace App\Domain\Settings\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;

/**
 * The singleton pseudo-model that owns the business logo (02 §10): the `business` row of
 * `app_settings` viewed as a media owner. Settings values are never read or written through it.
 *
 * @property string $key
 * @property mixed $value
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['key', 'value'])]
final class BusinessProfile extends Model implements HasMedia
{
    use InteractsWithMedia;

    public const string KEY = 'business';

    protected $table = 'app_settings';

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $incrementing = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'value' => 'json',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** The `business` row; created empty when settings were never seeded (stored fields merge over defaults). */
    public static function instance(): self
    {
        return self::query()->firstOrCreate(['key' => self::KEY], ['value' => (object) []]);
    }

    /** 02 §10: one logo (png, webp, jpg) on the public disk. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('logo')
            ->useDisk('s3-public')
            ->singleFile()
            ->acceptsMimeTypes(['image/png', 'image/webp', 'image/jpeg']);
    }
}
