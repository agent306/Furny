<?php

declare(strict_types=1);

namespace App\Domain\Projects\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `plan_revisions.reason` (02 §3.3). */
#[TypeScript]
enum PlanRevisionReason: string
{
    case ManualCheckpoint = 'manual_checkpoint';
    case ImportAccepted = 'import_accepted';
    case BeforeRestore = 'before_restore';
    case StaffEdit = 'staff_edit';
    case AutoDaily = 'auto_daily';
}
