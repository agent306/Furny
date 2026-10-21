<?php

declare(strict_types=1);

namespace App\Domain\Shared\Data;

use App\Domain\Shared\Enums\UploadPurpose;
use Spatie\LaravelData\Data;

/** The body of `api.uploads.presign` (13 §11.2), as `PresignUploadRequest` validates it. */
final class PresignUploadData extends Data
{
    public function __construct(
        public UploadPurpose $purpose,
        public string $filename,
        /** Bytes. */
        public int $size,
        public string $contentType,
        public ?PresignTargetData $target = null,
    ) {}
}
