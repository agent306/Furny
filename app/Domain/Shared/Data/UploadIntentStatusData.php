<?php

declare(strict_types=1);

namespace App\Domain\Shared\Data;

use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use Illuminate\Support\Facades\Storage;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\LiteralTypeScriptType;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** The answer of `api.uploads.show` (13 §11.3): what the client polls for until the upload is `ready` or `rejected`. */
#[TypeScript]
final class UploadIntentStatusData extends Data
{
    /** Only images have a preview; the signed URL lives this long (13 §11.6). */
    private const int PREVIEW_MINUTES = 15;

    private const array PREVIEW_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

    public function __construct(
        public string $uploadId,
        /** `uploaded` is reported as `processing` (14 §18.1). */
        #[LiteralTypeScriptType("'pending' | 'processing' | 'ready' | 'rejected' | 'consumed' | 'expired'")]
        public string $status,
        /** Why the upload was turned down: a key of `uploads.errors`. */
        public ?string $reasonCode,
        /** A signed URL of the processed image, for a `ready` upload that is one. */
        public ?string $previewUrl,
        public ?int $width,
        public ?int $height,
    ) {}

    public static function fromIntent(UploadIntent $intent): self
    {
        $previewable = $intent->status === UploadStatus::Ready
            && $intent->processed_key !== null
            && in_array($intent->sniffed_mime, self::PREVIEW_MIMES, true);

        return new self(
            $intent->id,
            $intent->status === UploadStatus::Uploaded ? 'processing' : $intent->status->value,
            $intent->reason_code,
            $previewable ? Storage::disk('s3')->temporaryUrl((string) $intent->processed_key, now()->addMinutes(self::PREVIEW_MINUTES)) : null,
            $intent->width,
            $intent->height,
        );
    }
}
