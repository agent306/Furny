<?php

declare(strict_types=1);

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Psr\Log\LoggerInterface;

/**
 * Captures what `Log::channel('security')` receives; every other log call keeps working.
 *
 * @param  list<array{string, array<string, mixed>}>  $logged
 */
function captureSecurityLog(array &$logged): void
{
    $channel = Mockery::mock(LoggerInterface::class);
    $channel->shouldReceive('warning')->andReturnUsing(function (string $message, array $context = []) use (&$logged): void {
        $logged[] = [$message, $context];
    });

    Log::partialMock()->shouldReceive('channel')->with('security')->andReturn($channel);
}

/** @return array<string, mixed> */
function violation(array $overrides = []): array
{
    return ['csp-report' => $overrides + [
        'document-uri' => 'https://furny.test/projects',
        'referrer' => '',
        'violated-directive' => 'script-src-elem',
        'effective-directive' => 'script-src-elem',
        'original-policy' => "default-src 'self'; report-uri /csp-report",
        'disposition' => 'enforce',
        'blocked-uri' => 'https://evil.example/x.js',
        'status-code' => 200,
    ]];
}

function postReport(mixed $body, array $headers = []): TestResponse
{
    return test()->call('POST', '/csp-report', [], [], [], array_merge([
        'CONTENT_TYPE' => 'application/csp-report',
    ], $headers), is_string($body) ? $body : json_encode($body, JSON_THROW_ON_ERROR));
}

it('accepts a violation report without a CSRF token and answers 204', function (): void {
    // CSRF is skipped when running unit tests; make the middleware enforce it for real.
    $this->app['env'] = 'local';
    $logged = [];
    captureSecurityLog($logged);

    postReport(violation())->assertNoContent();

    expect($logged)->toHaveCount(1)
        ->and($logged[0][0])->toBe('csp.violation')
        ->and($logged[0][1]['report'])->toContain('script-src-elem')->toContain('https://evil.example/x.js');
});

it('exempts csp-report and webhooks from CSRF, and nothing else', function (): void {
    $excluded = app(PreventRequestForgery::class)->getExcludedPaths();

    expect($excluded)->toContain('csp-report')->toContain('webhooks/*');
});

it('still enforces CSRF on other POST routes', function (): void {
    $this->app['env'] = 'local';

    $this->post('/logout')->assertStatus(419);
});

it('logs at most 2 KB, never the raw body', function (): void {
    $logged = [];
    captureSecurityLog($logged);
    $huge = violation(['script-sample' => str_repeat('A', 50_000), 'blocked-uri' => 'https://evil.example/'.str_repeat('p', 10_000)]);

    postReport($huge)->assertNoContent();

    expect(strlen($logged[0][1]['report']))->toBeLessThanOrEqual(2048)
        ->and($logged[0][1]['report'])->not->toContain('AAAA');
});

it('does not log an oversized or malformed body at all, only its size', function (string $body): void {
    $logged = [];
    captureSecurityLog($logged);

    postReport($body)->assertNoContent();

    expect($logged)->toHaveCount(1)
        ->and(strlen(json_encode($logged[0][1], JSON_THROW_ON_ERROR)))->toBeLessThanOrEqual(2048)
        ->and(json_encode($logged[0][1]))->not->toContain('secret-token');
})->with([
    'not json' => ['not json secret-token'],
    'json scalar' => ['"secret-token"'],
    'oversized' => ['{"csp-report":{"x":"secret-token'.str_repeat('a', 200_000).'"}}'],
    'empty' => [''],
]);

it('drops the query string and fragment of the reported URLs', function (): void {
    $logged = [];
    captureSecurityLog($logged);

    postReport(violation([
        'document-uri' => 'https://furny.test/reset-password/abc123?token=SECRET1&email=asha@example.com#frag',
        'blocked-uri' => 'https://evil.example/x.js?session=SECRET2',
        'referrer' => 'https://furny.test/login?code=SECRET3',
        'source-file' => 'https://user:pw@furny.test/build/app.js?v=SECRET4',
    ]))->assertNoContent();

    $report = $logged[0][1]['report'];

    expect($report)->toContain('https://furny.test/reset-password/[token]')
        ->and($report)->toContain('https://evil.example/x.js')
        ->and($report)->not->toContain('SECRET')
        ->and($report)->not->toContain('asha@example.com')
        ->and($report)->not->toContain('token=')
        ->and($report)->not->toContain('user:pw');
});

it('keeps non-URL blocked values such as inline and eval', function (string $blocked): void {
    $logged = [];
    captureSecurityLog($logged);

    postReport(violation(['blocked-uri' => $blocked]))->assertNoContent();

    expect($logged[0][1]['report'])->toContain($blocked);
})->with(['inline', 'eval', 'data', 'blob']);

it('leaves out the original policy and script samples', function (): void {
    $logged = [];
    captureSecurityLog($logged);

    postReport(violation(['script-sample' => 'alert("asha@example.com")']))->assertNoContent();

    expect($logged[0][1]['report'])->not->toContain('asha@example.com')->not->toContain('original-policy');
});

it('starts no session and sets no cookie', function (): void {
    $response = postReport(violation())->assertNoContent();

    expect($response->headers->getCookies())->toBe([]);
});

it('throttles at 30 per minute per IP with the rate_limited JSON', function (): void {
    foreach (range(1, 30) as $_) {
        postReport(violation(), ['HTTP_ACCEPT' => 'application/json'])->assertNoContent();
    }

    postReport(violation(), ['HTTP_ACCEPT' => 'application/json'])
        ->assertStatus(429)
        ->assertHeader('Retry-After')
        ->assertJsonPath('code', 'rate_limited')
        ->assertJsonStructure(['code', 'retryAfter']);

    // A different client is not affected.
    postReport(violation(), ['HTTP_ACCEPT' => 'application/json', 'REMOTE_ADDR' => '198.51.100.20'])->assertNoContent();
});

it('answers a throttled browser report with JSON too, though it asks for none', function (): void {
    foreach (range(1, 30) as $_) {
        postReport(violation())->assertNoContent();
    }

    postReport(violation())->assertStatus(429)->assertJsonPath('code', 'rate_limited');
});

describe('token path segments', function (): void {
    it('masks the token of :uri', function (string $uri, string $masked): void {
        $logged = [];
        captureSecurityLog($logged);

        postReport(violation(['document-uri' => $uri, 'referrer' => $uri]))->assertNoContent();

        $report = json_decode($logged[0][1]['report'], true, flags: JSON_THROW_ON_ERROR);

        expect($report['document-uri'])->toBe($masked)
            ->and($logged[0][1]['report'])->not->toContain('SECRETTOKEN');
    })->with([
        'password reset' => ['https://furny.test/reset-password/SECRETTOKEN?email=a@b.co', 'https://furny.test/reset-password/[token]'],
        'email verification hash' => ['https://furny.test/email/verify/01J9Z8X7Q2M3N4P5R6S7T8V9WX/SECRETTOKEN?signature=x', 'https://furny.test/email/verify/01J9Z8X7Q2M3N4P5R6S7T8V9WX/[token]'],
        'any long opaque segment' => ['https://furny.test/admin/catalog/imports/SECRETTOKENabcdefghijklmnopqrstuvwxyz0123', 'https://furny.test/admin/catalog/imports/[token]'],
        'msg91 webhook token' => ['https://furny.test/webhooks/msg91/SECRETTOKEN0123456789abcdefghijklmnop', 'https://furny.test/webhooks/msg91/[token]'],
    ]);

    it('masks a token segment of a route the app defines later', function (): void {
        Route::get('/_claim/{code}/{token}', fn () => 'x');
        $logged = [];
        captureSecurityLog($logged);

        postReport(violation(['document-uri' => 'https://furny.test/_claim/ABC/SECRETTOKEN']))->assertNoContent();

        $report = json_decode($logged[0][1]['report'], true, flags: JSON_THROW_ON_ERROR);

        expect($report['document-uri'])->toBe('https://furny.test/_claim/ABC/[token]');
    });

    it('keeps ids, uuids and ordinary paths readable', function (): void {
        $logged = [];
        captureSecurityLog($logged);
        $uri = 'https://furny.test/customer/projects/01J9Z8X7Q2M3N4P5R6S7T8V9WX/plans/01J9Z8X7Q2M3N4P5R6S7T8V9WY/media/123e4567-e89b-12d3-a456-426614174000';

        postReport(violation(['document-uri' => $uri]))->assertNoContent();

        expect(json_decode($logged[0][1]['report'], true, flags: JSON_THROW_ON_ERROR)['document-uri'])->toBe($uri);
    });
});

it('refuses an oversized declared body without reading it', function (): void {
    $logged = [];
    captureSecurityLog($logged);

    postReport('{"csp-report":{"blocked-uri":"inline"}}', ['CONTENT_LENGTH' => '5000000'])->assertNoContent();

    expect(json_decode($logged[0][1]['report'], true, flags: JSON_THROW_ON_ERROR))->toBe(['unreadable' => 'too_large', 'bytes' => 5000000]);
});
