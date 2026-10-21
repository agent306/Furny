<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

/** 09 §1: Submitted. */
final class Submitted extends OrderState
{
    public static string $name = 'submitted';
}
