<?php

declare(strict_types=1);

namespace App\Domain\Orders\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `change_proposals.status` (02 §8.3); moved by the proposal transitions T6–T8 (09 §2). */
#[TypeScript]
enum ChangeProposalStatus: string
{
    case Draft = 'draft';
    case Sent = 'sent';
    case Resolved = 'resolved';
    case Withdrawn = 'withdrawn';
}
