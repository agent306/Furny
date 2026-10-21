<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use Closure;

/**
 * The six-digit verification code (13 §4.1): a uniformly random integer from 0 to 999999, zero-padded to six
 * digits. The integer source is injectable so a test can force the edges of the range.
 */
final class OtpCodeGenerator
{
    public const int MAX = 999999;

    /** @var Closure(int, int): int */
    private readonly Closure $integer;

    /**
     * @param  (Closure(int, int): int)|null  $integer  `fn (int $min, int $max): int`; `random_int` when null
     */
    public function __construct(?Closure $integer = null)
    {
        $this->integer = $integer ?? random_int(...);
    }

    public function generate(): string
    {
        return str_pad((string) ($this->integer)(0, self::MAX), 6, '0', STR_PAD_LEFT);
    }
}
