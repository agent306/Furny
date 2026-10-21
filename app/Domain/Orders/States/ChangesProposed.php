<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Changes proposed. */
final class ChangesProposed extends OrderState
{
    public static string $name = 'changes_proposed';
}
