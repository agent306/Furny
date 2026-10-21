<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Quote sent. */
final class Quoted extends OrderState
{
    public static string $name = 'quoted';
}
