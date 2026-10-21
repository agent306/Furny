<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `furniture_revisions.author_kind` (02 §5.2). */
#[TypeScript]
enum AuthorKind: string
{
    case Customer = 'customer';
    case Staff = 'staff';
}
