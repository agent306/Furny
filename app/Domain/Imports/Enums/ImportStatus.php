<?php

declare(strict_types=1);

namespace App\Domain\Imports\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `blueprint_imports.status` (02 §4.1); transitions are guarded in the import actions (06 §3). */
#[TypeScript]
enum ImportStatus: string
{
    case Uploaded = 'uploaded';
    case Queued = 'queued';
    case Preprocessing = 'preprocessing';
    case Recognizing = 'recognizing';
    case ReadyForReview = 'ready_for_review';
    case Accepted = 'accepted';
    case Discarded = 'discarded';
    case Failed = 'failed';
    case Cancelled = 'cancelled';
}
