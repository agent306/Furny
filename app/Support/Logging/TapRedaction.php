<?php

declare(strict_types=1);

namespace App\Support\Logging;

use Illuminate\Log\Logger;
use Monolog\Logger as Monolog;

/** `'tap'` entry of every channel in config/logging.php (13 §16 rule 2). */
final class TapRedaction
{
    public function __invoke(Logger|Monolog $logger): void
    {
        $monolog = $logger instanceof Logger ? $logger->getLogger() : $logger;

        if ($monolog instanceof Monolog) {
            $monolog->pushProcessor(new RedactPiiProcessor);
        }
    }
}
