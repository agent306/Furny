<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Logging\RedactPiiProcessor;
use Illuminate\Contracts\Support\Arrayable;
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

describe('sensitive keys are matched by whole words, not substrings', function (): void {
    it('redacts :key', function (string $key): void {
        expect(redact('x', [$key => 'v'])->context[$key])->toBe('[redacted]');
    })->with([
        'code', 'codes', 'otp', 'otp_code', 'verification_code', 'recovery_codes', 'promo_code', 'two-factor-code', 'accessToken',
        'apiKey', 'apikey', 'API_KEY', 'api-key', 'X-Api-Key', 'password', 'passwords', 'new_password', 'currentPassword',
        'token', 'remember_token', 'secret', 'client_secret', 'authorization', 'cookie', 'set-cookie', 'session', 'session_id', 'sessionId',
    ]);

    it('keeps :key', function (string $key): void {
        expect(redact('x', [$key => 'v'])->context[$key])->toBe('v');
    })->with([
        'status_code', 'http_code', 'statusCode', 'country_code', 'error_code', 'response_code', 'exit_code', 'currency_code',
        'postal_code', 'zip_code', 'language_code', 'encoded', 'decoder', 'keyboard', 'tokenizer', 'orderNumber', 'count', 'key',
    ]);
});

describe('phone numbers are masked, dates, times and ids are not', function (): void {
    it('masks :text', function (string $text, string $masked): void {
        expect(redact($text)->message)->toBe($masked);
    })->with([
        'e164' => ['call +919876543210 now', 'call +91******3210 now'],
        'spaces' => ['call +91 98765 43210 now', 'call +91******3210 now'],
        'hyphens' => ['call +1-415-555-2671.', 'call +1******2671.'],
        'national with spaces' => ['call 98765 43210 now', 'call ******3210 now'],
        'national with hyphens' => ['call 987-654-3210 now', 'call ******3210 now'],
        'after a date' => ['2026-10-20 98765 43210', '2026-10-20 ******3210'],
    ]);

    it('leaves :text alone', function (string $text): void {
        expect(redact($text)->message)->toBe($text);
    })->with([
        'iso date' => ['Created on 2026-10-20 by the system'],
        'iso datetime' => ['At 2026-10-20 12:00:00 and 2026-10-20T12:00:00.123456Z and 2026-10-20T12:00:00+05:30 done'],
        'time' => ['Took 12:34:56 to finish'],
        'long unix timestamp' => ['ts 1760961600000 and 1760961600'],
        'bare numeric id' => ['record 123456789012 saved'],
        'ulid' => ['project 01J9Z8X7Q2M3N4P5R6S7T8V9WX'],
        'order number' => ['order FRN-2026-0001-0002 shipped'],
        'file and line' => ['at /app/Http/Foo.php(123): bar()'],
        'bare ten digits' => ['count 9876543210'],
    ]);
});

describe('objects in the context', function (): void {
    it('masks a model before it is formatted', function (): void {
        $user = User::factory()->make(['email' => 'bob@example.com', 'phone_e164' => '+919876543210']);

        $context = redact('x', ['user' => $user])->context;

        expect(json_encode($context))->not->toContain('bob@example.com')->not->toContain('9876543210')
            ->and($context['user'])->toBeArray()
            ->and($context['user']['email'])->toBe('b*b@e******.com')
            ->and($context['user']['phone_e164'])->toBe('+91******3210');
    });

    it('masks Stringable, Arrayable and JsonSerializable values', function (): void {
        $stringable = new class implements Stringable
        {
            public function __toString(): string
            {
                return 'mail bob@example.com';
            }
        };
        $arrayable = new class implements Arrayable
        {
            public function toArray(): array
            {
                return ['email' => 'bob@example.com', 'password' => 'hunter2'];
            }
        };
        $serializable = new class implements JsonSerializable
        {
            public function jsonSerialize(): array
            {
                return ['phone' => '+919876543210'];
            }
        };

        $context = redact('x', ['s' => $stringable, 'a' => $arrayable, 'j' => $serializable])->context;

        expect($context['s'])->toBe('mail b*b@e******.com')
            ->and($context['a'])->toBe(['email' => 'b*b@e******.com', 'password' => '[redacted]'])
            ->and($context['j'])->toBe(['phone' => '+91******3210']);
    });
});
