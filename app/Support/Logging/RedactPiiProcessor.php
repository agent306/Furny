<?php

declare(strict_types=1);

namespace App\Support\Logging;

use App\Support\Privacy\Mask;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;

/**
 * Keeps secrets and PII out of every log line (13 §16 rule 2): sensitive context keys are replaced,
 * e-mail addresses and phone numbers in the message and in string values are masked, and long strings
 * are cut so a request body can never end up in a log.
 */
final class RedactPiiProcessor implements ProcessorInterface
{
    private const string SENSITIVE_KEY = '/(password|token|secret|code|otp|authorization|cookie|api[_-]?key|session)/i';

    private const string EMAIL = '/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/';

    private const string PHONE = '/\+?\d[\d\s-]{8,}\d/';

    private const int MAX_STRING_LENGTH = 2000;

    public const string REDACTED = '[redacted]';

    public function __invoke(LogRecord $record): LogRecord
    {
        return $record->with(
            message: $this->mask($record->message),
            context: $this->walk($record->context),
        );
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<array-key, mixed>
     */
    private function walk(array $values): array
    {
        foreach ($values as $key => $value) {
            if (is_string($key) && preg_match(self::SENSITIVE_KEY, $key) === 1) {
                $values[$key] = self::REDACTED;
            } elseif (is_array($value)) {
                $values[$key] = $this->walk($value);
            } elseif (is_string($value)) {
                $values[$key] = $this->truncate($this->mask($value));
            }
        }

        return $values;
    }

    private function mask(string $text): string
    {
        $text = preg_replace_callback(self::EMAIL, fn (array $match): string => Mask::email($match[0]), $text) ?? $text;

        return preg_replace_callback(self::PHONE, fn (array $match): string => Mask::phone($match[0]), $text) ?? $text;
    }

    private function truncate(string $text): string
    {
        return mb_strlen($text) > self::MAX_STRING_LENGTH ? mb_substr($text, 0, self::MAX_STRING_LENGTH) : $text;
    }
}
