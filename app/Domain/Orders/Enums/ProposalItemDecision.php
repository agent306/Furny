<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `change_proposal_items.decision` (02 §8.4): the customer's answer per proposed item. */
#[TypeScript]
enum ProposalItemDecision: string
{
    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';
}
