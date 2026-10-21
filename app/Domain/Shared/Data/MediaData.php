<?php

declare(strict_types=1);

namespace App\Domain\Shared\Data;

use App\Support\Media\Media;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** A private file as a page shows it (10 §3). Every URL is the policy-checked `media.show`, never a storage URL. */
#[TypeScript]
final class MediaData extends Data
{
    public function __construct(
        /** The media uuid. */
        public string $id,
        public string $name,
        public string $mimeType,
        public int $size,
        public string $url,
        /** Images only; `media.show` answers with the file itself while the conversion is not made. */
        public ?string $thumbUrl,
        public ?string $largeUrl,
        public ?int $width,
        public ?int $height,
    ) {}

    public static function fromMedia(Media $media): self
    {
        $url = route('media.show', $media->uuid);
        $image = str_starts_with($media->mime_type, 'image/');
        $width = $media->getCustomProperty('width');
        $height = $media->getCustomProperty('height');

        return new self(
            $media->uuid,
            $media->name,
            $media->mime_type,
            $media->size,
            $url,
            $image ? $url.'?conversion=thumb' : null,
            $image ? $url.'?conversion=large' : null,
            is_int($width) ? $width : null,
            is_int($height) ? $height : null,
        );
    }
}
