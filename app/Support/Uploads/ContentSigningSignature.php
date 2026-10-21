<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use Aws\Signature\S3SignatureV4;

/**
 * Signature version 4 for presigned PUTs that signs `Content-Type` and `Content-Length`.
 *
 * The SDK leaves both headers out of a presigned URL (the first because "the caller determines it at upload time",
 * the second as a hop-by-hop header), so a URL from `Storage::temporaryUploadUrl()` accepts a body of any type and
 * length. 13 §11.2 needs the storage service to turn away any other type or length, so this signer keeps both in
 * `X-Amz-SignedHeaders`: a PUT that differs in either gets `403 SignatureDoesNotMatch`.
 */
final class ContentSigningSignature extends S3SignatureV4
{
    /** @return array<string, true> */
    protected function getHeaderBlacklist()
    {
        $blacklist = parent::getHeaderBlacklist();
        unset($blacklist['content-length']);

        return $blacklist;
    }

    /** @return array<string, true> */
    protected function getPresignHeaderDenyList()
    {
        $denyList = parent::getPresignHeaderDenyList();
        unset($denyList['content-type']);

        return $denyList;
    }
}
