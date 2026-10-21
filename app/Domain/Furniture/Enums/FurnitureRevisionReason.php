<?php

declare(strict_types=1);

namespace App\Domain\Furniture\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `furniture_revisions.reason` (02 §5.2). */
#[TypeScript]
enum FurnitureRevisionReason: string
{
    case ManualCheckpoint = 'manual_checkpoint';
    case OrderSubmitted = 'order_submitted';
    case StaffProposal = 'staff_proposal';
    case ProposalApplied = 'proposal_applied';
    case BeforeRestore = 'before_restore';
}
