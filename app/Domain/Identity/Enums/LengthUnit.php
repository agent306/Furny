<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `users.length_unit`: the editor input unit (02 §1.1); metric systems use mm/cm/m, imperial ftin/in. */
#[TypeScript]
enum LengthUnit: string
{
    case Mm = 'mm';
    case Cm = 'cm';
    case M = 'm';
    case Ftin = 'ftin';
    case In = 'in';

    public function allowedFor(UnitSystem $system): bool
    {
        return match ($system) {
            UnitSystem::Metric => in_array($this, [self::Mm, self::Cm, self::M], true),
            UnitSystem::Imperial => in_array($this, [self::Ftin, self::In], true),
        };
    }
}
