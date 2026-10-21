<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

beforeEach(function (): void {
    Route::middleware('web')->get('/_ip', fn () => response()->json([
        'ip' => request()->ip(),
        'host' => request()->getHost(),
        'secure' => request()->isSecure(),
    ]));
});

/** 13 §12.8, §20.18. */
it('resolves the client IP behind a trusted proxy', function (string $proxy): void {
    $response = $this->withServerVariables(['REMOTE_ADDR' => $proxy])
        ->getJson('/_ip', ['X-Forwarded-For' => '203.0.113.9']);

    expect($response->json('ip'))->toBe('203.0.113.9');
})->with([
    'Docker 10/8' => '10.0.0.5',
    'Docker 172.16/12' => '172.18.0.2',
    'Docker 192.168/16' => '192.168.1.10',
    'loopback' => '127.0.0.1',
]);

it('ignores a spoofed X-Forwarded-For from an untrusted peer', function (): void {
    $response = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])
        ->getJson('/_ip', ['X-Forwarded-For' => '203.0.113.9', 'X-Forwarded-Proto' => 'https', 'X-Forwarded-Host' => 'evil.example']);

    expect($response->json('ip'))->toBe('198.51.100.7')
        ->and($response->json('secure'))->toBeFalse()
        ->and($response->json('host'))->not->toBe('evil.example');
});

it('takes the scheme from a trusted proxy', function (): void {
    $response = $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])
        ->getJson('/_ip', ['X-Forwarded-For' => '203.0.113.9', 'X-Forwarded-Proto' => 'https']);

    expect($response->json('secure'))->toBeTrue();
});

it('does not trust CF-Connecting-IP', function (): void {
    $response = $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])
        ->getJson('/_ip', ['CF-Connecting-IP' => '203.0.113.99']);

    expect($response->json('ip'))->toBe('10.0.0.5');
});

it('takes the nearest address that is not a trusted proxy from a multi-value X-Forwarded-For', function (string $header, string $expected): void {
    $response = $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])->getJson('/_ip', ['X-Forwarded-For' => $header]);

    expect($response->json('ip'))->toBe($expected);
})->with([
    'client, then a second trusted proxy' => ['203.0.113.9, 10.0.0.7', '203.0.113.9'],
    'client, two trusted proxies' => ['203.0.113.9, 172.18.0.3, 10.0.0.7', '203.0.113.9'],
    'a client-supplied value ahead of the real one is ignored' => ['1.2.3.4, 203.0.113.9', '203.0.113.9'],
    'spoofed value and a proxy behind the real client' => ['1.2.3.4, 203.0.113.9, 10.0.0.7', '203.0.113.9'],
    'every hop trusted falls back to the left-most' => ['10.0.0.9, 10.0.0.7', '10.0.0.9'],
]);

it('ignores a multi-value X-Forwarded-For from an untrusted peer', function (): void {
    $response = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])
        ->getJson('/_ip', ['X-Forwarded-For' => '203.0.113.9, 10.0.0.7']);

    expect($response->json('ip'))->toBe('198.51.100.7');
});
