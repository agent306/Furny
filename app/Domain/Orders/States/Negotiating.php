<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Negotiating. */
final class Negotiating extends OrderState
{
    public static string $name = 'negotiating';
}
