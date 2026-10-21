<?php

declare(strict_types=1);

namespace App\Domain\Projects\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `projects.property_type` (02 §3.1). */
#[TypeScript]
enum PropertyType: string
{
    case Apartment = 'apartment';
    case IndependentHouse = 'independent_house';
    case Villa = 'villa';
    case Office = 'office';
    case Other = 'other';
}
