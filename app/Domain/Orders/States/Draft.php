<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Draft. */
final class Draft extends OrderState
{
    public static string $name = 'draft';
}
