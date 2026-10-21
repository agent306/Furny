<?php

declare(strict_types=1);

namespace App\Support\Logging;

use App\Support\Privacy\Mask;
use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Database\Eloquent\Model;
use JsonSerializable;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;
use Stringable;
use Throwable;

/**
 * Keeps secrets and PII out of every log line (13 §16 rule 2): sensitive context keys are replaced,
 * e-mail addresses and phone numbers in the message and in string values are masked, long strings are
 * cut so a request body can never end up in a log, and models and other value objects are reduced to
 * masked arrays or strings. Exceptions stay objects here (error trackers need them); `RedactingFormatter`
 * masks what a formatter writes of them.
 */
final class RedactPiiProcessor implements ProcessorInterface
{
    public const string REDACTED = '[redacted]';

    private const string EMAIL = '/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/';

    /**
     * Alternatives, leftmost first: an ISO date or time (kept as it is, so the digits in it are never read
     * as a phone number), else a phone number. The number must not start inside a word, a number or a
     * hyphenated code; the separators are spaces, hyphens and brackets only.
     */
    private const string PHONE_OR_TIMESTAMP = '/(?<keep>\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)|(?<phone>(?<![\w.\-])\+?\d[\d ()\-]{7,}\d)/';

    private const int MAX_STRING_LENGTH = 2000;

    private const int MAX_DEPTH = 6;

    /**
     * Secret words (13 §16 rule 2): a key containing one anywhere is sensitive, spelled however the caller
     * joins the words (`accesstoken`, `clientSecret`, `X-Api-Key`, `sessionid`). Compared on the key with
     * everything but letters and digits removed.
     */
    private const array SECRET_SUBSTRINGS = ['password', 'passwd', 'token', 'secret', 'authorization', 'cookie', 'session', 'apikey'];

    /** Short or ambiguous words: sensitive only as a whole word of the key (`otp_code`, but not `footprint`). */
    private const array SECRET_WORDS = ['otp'];

    /** `code` is sensitive (`otp_code`, `recovery_codes`) unless a word before it says what kind of code it is. */
    private const array HARMLESS_CODE_QUALIFIERS = [
        'status', 'http', 'country', 'error', 'response', 'exit', 'currency', 'postal', 'zip', 'language', 'locale',
        'dial', 'area', 'region', 'state', 'reason', 'line', 'file', 'event', 'item', 'sku', 'hs',
    ];

    public function __invoke(LogRecord $record): LogRecord
    {
        return $record->with(
            message: self::maskText($record->message),
            context: $this->walk($record->context, 0),
        );
    }

    /** E-mail addresses and phone numbers in a text, masked. */
    public static function maskText(string $text): string
    {
        $text = preg_replace_callback(self::EMAIL, fn (array $match): string => Mask::email($match[0]), $text) ?? $text;

        return preg_replace_callback(self::PHONE_OR_TIMESTAMP, self::maskPhone(...), $text) ?? $text;
    }

    /**
     * True when a context key names a secret. `token`, `secret`, `password` and the like match anywhere in
     * the key; `otp` and `code` only as whole words, so `status_code` is fine and `otp_code` is not.
     */
    public static function isSensitiveKey(string $key): bool
    {
        $snake = strtolower((string) preg_replace('/(?<=[a-z0-9])(?=[A-Z])/', '_', $key));
        $flat = (string) preg_replace('/[^a-z0-9]/', '', $snake);

        foreach (self::SECRET_SUBSTRINGS as $secret) {
            if (str_contains($flat, $secret)) {
                return true;
            }
        }

        $words = array_values(array_filter(preg_split('/[^a-z0-9]+/', $snake) ?: []));

        foreach ($words as $index => $word) {
            if (in_array($word, self::SECRET_WORDS, true) || in_array(rtrim($word, 's'), self::SECRET_WORDS, true)) {
                return true;
            }

            if (($word === 'code' || $word === 'codes') && ! in_array($words[$index - 1] ?? null, self::HARMLESS_CODE_QUALIFIERS, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<array-key, mixed>
     */
    private function walk(array $values, int $depth): array
    {
        foreach ($values as $key => $value) {
            $values[$key] = is_string($key) && self::isSensitiveKey($key) ? self::REDACTED : $this->value($value, $depth);
        }

        return $values;
    }

    private function value(mixed $value, int $depth): mixed
    {
        if ($depth >= self::MAX_DEPTH) {
            return is_scalar($value) || $value === null ? $value : '[…]';
        }

        return match (true) {
            is_string($value) => $this->truncate(self::maskText($value)),
            $value instanceof Throwable => $value,
            is_array($value) => $this->walk($value, $depth + 1),
            $value instanceof Model => $this->walk($value->attributesToArray(), $depth + 1),
            $value instanceof Arrayable => $this->walk($value->toArray(), $depth + 1),
            $value instanceof JsonSerializable => $this->value($value->jsonSerialize(), $depth + 1),
            $value instanceof Stringable => $this->truncate(self::maskText((string) $value)),
            default => $value,
        };
    }

    /** @param  array<int|string, string>  $match */
    private static function maskPhone(array $match): string
    {
        if (($match['keep'] ?? '') !== '' || ($match['phone'] ?? '') === '') {
            return $match[0];
        }

        $number = $match['phone'];
        $digits = strlen((string) preg_replace('/\D/', '', $number));

        // E.164 has at most 15 digits. Without a leading + it must be written like a phone number (grouped).
        $grouped = preg_match('/[ \-]/', $number) === 1;

        if ($digits < 9 || $digits > 15 || (! str_starts_with($number, '+') && ! $grouped)) {
            return $number;
        }

        return Mask::phone($number);
    }

    private function truncate(string $text): string
    {
        return mb_strlen($text) > self::MAX_STRING_LENGTH ? mb_substr($text, 0, self::MAX_STRING_LENGTH) : $text;
    }
}
