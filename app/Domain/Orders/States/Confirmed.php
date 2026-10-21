<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Confirmed. */
final class Confirmed extends OrderState
{
    public static string $name = 'confirmed';
}
