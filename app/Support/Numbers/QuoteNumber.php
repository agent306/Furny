<?php

declare(strict_types=1);

namespace App\Support\Numbers;

/**
 * Quote numbers (master §6.3): `{order_number}-Q{version}`.
 */
final class QuoteNumber
{
    public static function for(string $orderNumber, int $version): string
    {
        return "{$orderNumber}-Q{$version}";
    }
}
