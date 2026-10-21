<?php

declare(strict_types=1);

namespace App\Support\Media;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;

/**
 * The application media model (`media-library.media_model`). Owners have ULIDs, stored in a
 * `char(26)` column; the accessor makes sure a padded value never leaks into lookups (02 §1.8).
 */
final class Media extends BaseMedia
{
    /**
     * @return Attribute<string|null, string|null>
     */
    protected function modelId(): Attribute
    {
        return Attribute::get(static fn (?string $value): ?string => $value === null ? null : rtrim($value));
    }
}
