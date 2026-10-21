<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Completed, awaiting the customer's check. */
final class Completed extends OrderState
{
    public static string $name = 'completed';
}
