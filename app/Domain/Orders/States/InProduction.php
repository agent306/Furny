<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: In production. */
final class InProduction extends OrderState
{
    public static string $name = 'in_production';
}
