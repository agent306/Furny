<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `users.type` (02 §1.1). */
#[TypeScript]
enum UserType: string
{
    case Customer = 'customer';
    case Staff = 'staff';
}
