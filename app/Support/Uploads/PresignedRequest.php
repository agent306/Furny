<?php

declare(strict_types=1);

namespace App\Support\Uploads;

/** A presigned PUT: the URL, and the headers the client must send with the exact values that were signed. */
final readonly class PresignedRequest
{
    /**
     * @param  array<string, string>  $headers
     */
    public function __construct(
        public string $url,
        public array $headers,
    ) {}
}
