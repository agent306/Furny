<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Delivered. */
final class Delivered extends OrderState
{
    public static string $name = 'delivered';
}
