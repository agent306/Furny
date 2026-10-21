<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `production_updates.visibility` (02 §8.9): internal updates never reach the customer. */
#[TypeScript]
enum ProductionVisibility: string
{
    case Customer = 'customer';
    case Internal = 'internal';
}
