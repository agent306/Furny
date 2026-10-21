<?php

declare(strict_types=1);

namespace App\Support\Logging;

use Monolog\Formatter\FormatterInterface;
use Monolog\LogRecord;

/**
 * Masks e-mail addresses and phone numbers in whatever a handler's formatter writes. This is what covers
 * exceptions (message, previous exceptions, stack-trace arguments) and any object the formatter
 * stringifies, however it got into the record.
 */
final class RedactingFormatter implements FormatterInterface
{
    public function __construct(private readonly FormatterInterface $inner) {}

    public function inner(): FormatterInterface
    {
        return $this->inner;
    }

    public function format(LogRecord $record): mixed
    {
        return $this->mask($this->inner->format($record));
    }

    /** @param  array<array-key, LogRecord>  $records */
    public function formatBatch(array $records): mixed
    {
        return $this->mask($this->inner->formatBatch($records));
    }

    private function mask(mixed $formatted): mixed
    {
        if (is_string($formatted)) {
            return RedactPiiProcessor::maskText($formatted);
        }

        if (is_array($formatted)) {
            return array_map($this->mask(...), $formatted);
        }

        return $formatted;
    }
}
