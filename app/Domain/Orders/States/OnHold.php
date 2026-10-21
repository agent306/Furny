<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: On hold. */
final class OnHold extends OrderState
{
    public static string $name = 'on_hold';
}
