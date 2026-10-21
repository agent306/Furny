<?php

declare(strict_types=1);

namespace App\Support\Uploads;

/** Turns a HEIC photo on the `s3` disk into a JPEG on the same disk (13 §11.3), because PHP has no HEIC decoder. */
interface HeicConverter
{
    /**
     * @throws UploadRejected `upload_corrupt` when the file cannot be decoded
     */
    public function toJpeg(string $sourceKey, string $targetKey): void;
}
