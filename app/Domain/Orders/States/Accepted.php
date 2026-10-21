<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Quote accepted. */
final class Accepted extends OrderState
{
    public static string $name = 'accepted';
}
