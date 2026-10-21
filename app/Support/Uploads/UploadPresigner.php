<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use Carbon\CarbonInterface;

/**
 * Presigned URLs on the private `s3` disk (13 §11.2). An interface because a faked disk cannot sign upload URLs: the
 * tests bind a stand-in.
 */
interface UploadPresigner
{
    /**
     * A PUT of exactly `$size` bytes of `$contentType` to `$key`. The storage service rejects any other type or length.
     * `$size` is null only for the vision service, which writes an image whose length is not known in advance.
     */
    public function presignPut(string $key, string $contentType, ?int $size, CarbonInterface $expiresAt): PresignedRequest;

    public function presignGet(string $key, CarbonInterface $expiresAt): string;
}
