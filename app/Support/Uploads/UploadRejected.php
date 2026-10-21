<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use RuntimeException;

/**
 * An upload that must be turned down for good: `$reason` is the `reason_code` of the intent (13 §11.3), one of the keys
 * of `uploads.errors`. Anything else that goes wrong while processing (storage, the vision service) is an ordinary
 * exception, which the queue retries.
 */
final class UploadRejected extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("Upload rejected: {$reason}.");
    }
}
