<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Ready for delivery. */
final class ReadyForDelivery extends OrderState
{
    public static string $name = 'ready_for_delivery';
}
