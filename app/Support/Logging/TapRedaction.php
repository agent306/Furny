<?php

declare(strict_types=1);

namespace App\Support\Logging;

use Illuminate\Log\Logger;
use Monolog\Handler\FormattableHandlerInterface;
use Monolog\Logger as Monolog;

/**
 * `'tap'` entry of every channel in config/logging.php (13 §16 rule 2): the processor redacts the
 * record, and every handler's formatter is wrapped so nothing a formatter writes escapes masking.
 *
 * A stack shares its children's handlers, so wrapping is skipped for formatters that are already
 * wrapped. `Log::stack([...])` builds its logger without a tap, so only the handler-level masking
 * applies to it; the emergency logger (used when logging itself fails) is not tapped at all.
 */
final class TapRedaction
{
    public function __invoke(Logger|Monolog $logger): void
    {
        $monolog = $logger instanceof Logger ? $logger->getLogger() : $logger;

        if (! $monolog instanceof Monolog) {
            return;
        }

        $monolog->pushProcessor(new RedactPiiProcessor);

        foreach ($monolog->getHandlers() as $handler) {
            if ($handler instanceof FormattableHandlerInterface && ! $handler->getFormatter() instanceof RedactingFormatter) {
                $handler->setFormatter(new RedactingFormatter($handler->getFormatter()));
            }
        }
    }
}
