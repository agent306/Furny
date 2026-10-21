<?php

declare(strict_types=1);

use App\Support\Logging\RedactPiiProcessor;
use Monolog\Level;
use Monolog\LogRecord;

/** @param array<string, mixed> $context */
function redact(string $message, array $context = []): LogRecord
{
    return (new RedactPiiProcessor)(new LogRecord(new DateTimeImmutable, 'test', Level::Warning, $message, $context));
}

it('redacts the values of sensitive context keys and masks PII in free text', function (): void {
    $record = redact('hello', [
        'password' => 'x',
        'api_key' => 'y',
        'otp' => '123456',
        'note' => 'call +91 98765 43210 or asha@example.com',
    ]);

    expect($record->context['password'])->toBe('[redacted]')
        ->and($record->context['api_key'])->toBe('[redacted]')
        ->and($record->context['otp'])->toBe('[redacted]')
        ->and($record->context['note'])->toBe('call +91******3210 or a**a@e******.com');
});

it('redacts every sensitive key spelling, at any depth, whatever the case', function (string $key): void {
    $record = redact('x', ['outer' => ['inner' => [$key => 'secret-value']], $key => 'secret-value']);

    expect($record->context[$key])->toBe('[redacted]')
        ->and($record->context['outer']['inner'][$key])->toBe('[redacted]');
})->with([
    'password', 'new_password', 'TOKEN', 'access_token', 'client_secret', 'code', 'otp', 'Authorization',
    'cookie', 'api_key', 'api-key', 'apikey', 'session_id',
]);

it('redacts non-string values of sensitive keys too', function (): void {
    $record = redact('x', ['otp' => 123456, 'token' => ['a', 'b'], 'password' => null]);

    expect($record->context)->toBe(['otp' => '[redacted]', 'token' => '[redacted]', 'password' => '[redacted]']);
});

it('masks the message text as well', function (): void {
    $record = redact('Login failed for asha@example.com from +919876543210');

    expect($record->message)->toBe('Login failed for a**a@e******.com from +91******3210');
});

it('truncates context strings to 2 000 characters', function (): void {
    $record = redact('x', ['body' => str_repeat('a', 5000), 'nested' => ['body' => str_repeat('é', 5000)]]);

    expect(mb_strlen($record->context['body']))->toBe(2000)
        ->and(mb_strlen($record->context['nested']['body']))->toBe(2000);
});

it('leaves harmless values and non-string objects alone', function (): void {
    $exception = new RuntimeException('boom');
    $record = redact('x', ['orderNumber' => 'FRN-2026-0001', 'count' => 3, 'ok' => true, 'exception' => $exception]);

    expect($record->context['orderNumber'])->toBe('FRN-2026-0001')
        ->and($record->context['count'])->toBe(3)
        ->and($record->context['ok'])->toBeTrue()
        ->and($record->context['exception'])->toBe($exception);
});
