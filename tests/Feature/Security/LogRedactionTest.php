<?php

declare(strict_types=1);

use App\Support\Logging\TapRedaction;
use Illuminate\Support\Facades\Log;

/** Points a file-backed channel at a temp file and returns the path. */
function logFile(string $channel): string
{
    $path = tempnam(sys_get_temp_dir(), 'log-');
    config(["logging.channels.{$channel}.path" => $path]);

    return $path;
}

function forgetChannels(): void
{
    foreach (['stack', 'single', 'daily', 'security'] as $channel) {
        Log::forgetChannel($channel);
    }
}

it('taps every channel that is configured from the config file', function (string $channel): void {
    expect(config("logging.channels.{$channel}.tap"))->toBe([TapRedaction::class]);
})->with(['stack', 'single', 'daily', 'monthly', 'slack', 'papertrail', 'stderr', 'syslog', 'errorlog', 'null', 'security']);

it('has no channel without the tap but the emergency fallback', function (): void {
    $untapped = collect(config('logging.channels'))->reject(fn (array $channel) => ($channel['tap'] ?? null) === [TapRedaction::class])->keys()->all();

    expect($untapped)->toBe(['emergency']);
});

it('has a security channel', function (): void {
    expect(config('logging.channels.security'))->not->toBeNull();
});

it('redacts PII written through the default stack and its child channel', function (): void {
    config(['logging.default' => 'stack', 'logging.channels.stack.channels' => ['single']]);
    $path = logFile('single');
    forgetChannels();

    Log::warning('Login failed for asha@example.com', [
        'password' => 'hunter2',
        'token' => 'abc-token',
        'phone' => '+91 98765 43210',
        'nested' => ['api_key' => 'sk-live-123'],
    ]);

    $written = file_get_contents($path);

    expect($written)->toContain('[redacted]')
        ->and($written)->toContain('a**a@e******.com')
        ->and($written)->toContain('+91******3210')
        ->and($written)->not->toContain('hunter2')->not->toContain('abc-token')->not->toContain('sk-live-123')
        ->and($written)->not->toContain('asha@example.com')->not->toContain('98765 43210');
});

it('redacts a child channel written to directly', function (): void {
    config(['logging.channels.single.replace_placeholders' => true]);
    $path = logFile('single');
    forgetChannels();

    Log::channel('single')->info('Reset for {email}', ['email' => 'asha@example.com', 'secret' => 's3cr3t']);

    $written = file_get_contents($path);

    expect($written)->toContain('Reset for a**a@e******.com')->not->toContain('asha@example.com')->not->toContain('s3cr3t');
});

it('redacts the security channel, where CSP reports and auth events go', function (): void {
    config(['logging.channels.stack.channels' => ['single']]);
    $path = logFile('single');
    forgetChannels();

    Log::channel('security')->warning('auth.failed', ['email' => 'asha@example.com', 'cookie' => 'abc', 'ip' => '203.0.113.45']);

    $written = file_get_contents($path);

    expect($written)->toContain('security.WARNING')
        ->and($written)->toContain('a**a@e******.com')
        ->and($written)->toContain('[redacted]')
        ->and($written)->not->toContain('asha@example.com')->not->toContain('"abc"');
});

it('redacts the daily channel too', function (): void {
    config(['logging.default' => 'daily']);
    $dir = sys_get_temp_dir().'/log-'.bin2hex(random_bytes(4));
    config(['logging.channels.daily.path' => $dir.'/app.log']);
    forgetChannels();

    Log::error('boom', ['session' => 'sess-123']);

    $written = (string) file_get_contents(glob($dir.'/app-*.log')[0]);

    expect($written)->toContain('[redacted]')->not->toContain('sess-123');
});
