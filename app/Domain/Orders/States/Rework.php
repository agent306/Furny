<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Rework. */
final class Rework extends OrderState
{
    public static string $name = 'rework';
}
