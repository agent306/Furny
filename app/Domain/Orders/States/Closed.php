<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Closed (terminal). */
final class Closed extends OrderState
{
    public static string $name = 'closed';
}
