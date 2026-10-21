<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `quote_lines.kind` (02 §8.6); a `discount` line has a non-positive unit price and no tax rate. */
#[TypeScript]
enum QuoteLineKind: string
{
    case Furniture = 'furniture';
    case Materials = 'materials';
    case Hardware = 'hardware';
    case Labour = 'labour';
    case Finishing = 'finishing';
    case Installation = 'installation';
    case Delivery = 'delivery';
    case Discount = 'discount';
    case Custom = 'custom';
}
