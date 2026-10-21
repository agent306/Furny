<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use Carbon\CarbonInterface;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Filesystem\AwsS3V3Adapter;
use RuntimeException;

/** Presigns on the `s3` disk (AWS S3 or Cloudflare R2), with the type and length of a PUT signed into the URL. */
final class S3UploadPresigner implements UploadPresigner
{
    public function __construct(private readonly Filesystem $disk) {}

    public function presignPut(string $key, string $contentType, ?int $size, CarbonInterface $expiresAt): PresignedRequest
    {
        $disk = $this->adapter();
        $client = $disk->getClient();

        $parameters = ['Bucket' => $disk->getConfig()['bucket'] ?? '', 'Key' => $disk->path($key), 'ContentType' => $contentType];
        if ($size !== null) {
            $parameters['ContentLength'] = $size;
        }

        // The request the SDK would send, without its own signer: the PUT is signed here, with both headers.
        $command = $client->getCommand('PutObject', $parameters);
        $handlers = $command->getHandlerList();
        $handlers->remove('signer');
        $handlers->remove('s3.checksum');
        $request = \Aws\serialize($command);

        $signed = (new ContentSigningSignature('s3', $client->getRegion()))->presign(
            $request,
            $client->getCredentials()->wait(),
            $expiresAt,
        );

        return new PresignedRequest(
            (string) $signed->getUri(),
            ['Content-Type' => $contentType] + ($size === null ? [] : ['Content-Length' => (string) $size]),
        );
    }

    public function presignGet(string $key, CarbonInterface $expiresAt): string
    {
        return $this->disk->temporaryUrl($key, $expiresAt);
    }

    private function adapter(): AwsS3V3Adapter
    {
        if (! $this->disk instanceof AwsS3V3Adapter) {
            throw new RuntimeException('The upload disk is not an S3 disk.');
        }

        return $this->disk;
    }
}
