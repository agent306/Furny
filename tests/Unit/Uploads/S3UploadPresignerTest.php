<?php

declare(strict_types=1);

use App\Support\Uploads\S3UploadPresigner;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;

/** An `s3` disk with made-up credentials: nothing here talks to the network. */
function presignerDisk(): Filesystem
{
    return Storage::build([
        'driver' => 's3',
        'key' => 'AKIAEXAMPLE',
        'secret' => 'example-secret',
        'region' => 'auto',
        'bucket' => 'furny',
        'endpoint' => 'http://localhost:9000',
        'use_path_style_endpoint' => true,
        'throw' => true,
    ]);
}

/**
 * The SigV4 signature of a presigned PUT, worked out here from the URL and the headers that the browser must send,
 * independently of the code under test.
 *
 * @param  array<string, string>  $signedHeaders  lower-case name => value
 */
function presignerExpectedSignature(string $url, array $signedHeaders): string
{
    $parts = parse_url($url);
    parse_str((string) $parts['query'], $query);
    $date = $query['X-Amz-Date'];
    unset($query['X-Amz-Signature']);
    ksort($query);

    $canonicalQuery = implode('&', array_map(static fn (string $k, string $v): string => rawurlencode($k).'='.rawurlencode($v), array_keys($query), $query));
    ksort($signedHeaders);
    $canonicalHeaders = '';
    foreach ($signedHeaders as $name => $value) {
        $canonicalHeaders .= $name.':'.$value."\n";
    }

    $canonical = "PUT\n".$parts['path']."\n".$canonicalQuery."\n".$canonicalHeaders."\n".implode(';', array_keys($signedHeaders))."\nUNSIGNED-PAYLOAD";
    $scope = substr($date, 0, 8).'/auto/s3/aws4_request';
    $toSign = "AWS4-HMAC-SHA256\n".$date."\n".$scope."\n".hash('sha256', $canonical);

    $key = hash_hmac('sha256', 'aws4_request', hash_hmac('sha256', 's3', hash_hmac('sha256', 'auto', hash_hmac('sha256', substr($date, 0, 8), 'AWS4example-secret', true), true), true), true);

    return hash_hmac('sha256', $toSign, $key);
}

it('signs the content type and the exact length into the URL', function (): void {
    $presigned = (new S3UploadPresigner(presignerDisk()))->presignPut('tmp/avatar/2030/06/01J0EXAMPLE', 'image/png', 1_048_576, CarbonImmutable::now()->addMinutes(15));

    parse_str((string) parse_url($presigned->url, PHP_URL_QUERY), $query);

    expect($presigned->url)->toStartWith('http://localhost:9000/furny/tmp/avatar/2030/06/01J0EXAMPLE?')
        ->and($query['X-Amz-SignedHeaders'])->toBe('content-length;content-type;host')
        ->and((int) $query['X-Amz-Expires'])->toBeBetween(898, 900)
        ->and($presigned->headers)->toBe(['Content-Type' => 'image/png', 'Content-Length' => '1048576'])
        ->and($query['X-Amz-Signature'])->toBe(presignerExpectedSignature($presigned->url, [
            'content-length' => '1048576',
            'content-type' => 'image/png',
            'host' => 'localhost:9000',
        ]));
});

it('makes a PUT with another type or length fail the signature', function (): void {
    $presigned = (new S3UploadPresigner(presignerDisk()))->presignPut('tmp/avatar/2030/06/01J0EXAMPLE', 'image/png', 1_048_576, CarbonImmutable::now()->addMinutes(15));
    parse_str((string) parse_url($presigned->url, PHP_URL_QUERY), $query);

    foreach ([['1048577', 'image/png'], ['1048576', 'image/jpeg']] as [$length, $type]) {
        expect($query['X-Amz-Signature'])->not->toBe(presignerExpectedSignature($presigned->url, [
            'content-length' => $length,
            'content-type' => $type,
            'host' => 'localhost:9000',
        ]));
    }
});

it('signs without a length when none is known (the vision service writes the normalised image)', function (): void {
    $presigned = (new S3UploadPresigner(presignerDisk()))->presignPut('tmp/production_photo/2030/06/01J0EXAMPLE.jpg', 'image/jpeg', null, CarbonImmutable::now()->addMinutes(15));
    parse_str((string) parse_url($presigned->url, PHP_URL_QUERY), $query);

    expect($query['X-Amz-SignedHeaders'])->toBe('content-type;host')
        ->and($presigned->headers)->toBe(['Content-Type' => 'image/jpeg']);
});

it('presigns a GET for a key', function (): void {
    $url = (new S3UploadPresigner(presignerDisk()))->presignGet('tmp/blueprint_source/2030/06/01J0EXAMPLE', CarbonImmutable::now()->addMinutes(15));

    expect($url)->toStartWith('http://localhost:9000/furny/tmp/blueprint_source/2030/06/01J0EXAMPLE?')
        ->and($url)->toContain('X-Amz-Signature=');
});
