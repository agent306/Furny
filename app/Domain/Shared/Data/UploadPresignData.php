<?php

declare(strict_types=1);

namespace App\Domain\Shared\Data;

use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** The answer of `api.uploads.presign` (13 §11.2, 14 §18.1): where and how to PUT the bytes, and until when. */
#[TypeScript]
final class UploadPresignData extends Data
{
    public function __construct(
        public string $uploadId,
        public string $url,
        /** @var array<string, string> sent exactly as given, except the two a browser sets itself */
        public array $headers,
        /** ISO 8601: after this the PUT is refused. */
        public string $expiresAt,
    ) {}
}
