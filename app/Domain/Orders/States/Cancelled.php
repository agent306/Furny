<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Cancelled (terminal). */
final class Cancelled extends OrderState
{
    public static string $name = 'cancelled';
}
