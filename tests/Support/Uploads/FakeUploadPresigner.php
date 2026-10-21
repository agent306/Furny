<?php

declare(strict_types=1);

namespace Tests\Support\Uploads;

use App\Support\Uploads\PresignedRequest;
use App\Support\Uploads\UploadPresigner;
use Carbon\CarbonInterface;

/**
 * Stands in for `S3UploadPresigner`: a faked `s3` disk cannot create upload URLs. The URL carries the key in its
 * path, so a test (or an `Http::fake` callback) can read the key back with `keyOf()`.
 */
final class FakeUploadPresigner implements UploadPresigner
{
    public const string HOST = 'https://s3.test';

    /** @var list<array{key: string, contentType: string, size: int|null, expiresAt: CarbonInterface}> */
    public array $puts = [];

    /** @var list<array{key: string, expiresAt: CarbonInterface}> */
    public array $gets = [];

    public function presignPut(string $key, string $contentType, ?int $size, CarbonInterface $expiresAt): PresignedRequest
    {
        $this->puts[] = ['key' => $key, 'contentType' => $contentType, 'size' => $size, 'expiresAt' => $expiresAt];

        return new PresignedRequest(
            self::HOST.'/'.$key.'?op=put&expires='.$expiresAt->getTimestamp(),
            ['Content-Type' => $contentType] + ($size === null ? [] : ['Content-Length' => (string) $size]),
        );
    }

    public function presignGet(string $key, CarbonInterface $expiresAt): string
    {
        $this->gets[] = ['key' => $key, 'expiresAt' => $expiresAt];

        return self::HOST.'/'.$key.'?op=get&expires='.$expiresAt->getTimestamp();
    }

    public static function keyOf(string $url): string
    {
        return ltrim((string) parse_url($url, PHP_URL_PATH), '/');
    }
}
