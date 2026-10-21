<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use RuntimeException;

/**
 * A delivery channel DEFINITELY did not send the code (provider refused it, was never reached, not configured): the next
 * channel is tried and the send's counters are given back. A driver that cannot tell whether the message went out (a
 * timeout after the request left) must not throw this: it counts as sent.
 */
final class OtpDeliveryException extends RuntimeException {}
