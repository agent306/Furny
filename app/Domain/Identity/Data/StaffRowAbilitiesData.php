<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** What the signed-in staff member may do to one row of the staff table (11 §7). Display hints; the server decides. */
#[TypeScript]
final class StaffRowAbilitiesData extends Data
{
    public function __construct(
        public bool $edit,
        public bool $deactivate,
        public bool $activate,
        public bool $resetTwoFactor,
    ) {}
}
