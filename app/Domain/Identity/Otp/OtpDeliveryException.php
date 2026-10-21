<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use RuntimeException;

/** A delivery channel could not deliver the code (provider refused, unreachable, not configured); the next channel is tried. */
final class OtpDeliveryException extends RuntimeException {}
