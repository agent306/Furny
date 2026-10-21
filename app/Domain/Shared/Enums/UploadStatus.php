<?php

declare(strict_types=1);

namespace App\Domain\Shared\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `upload_intents.status` (02 §1.6). */
#[TypeScript]
enum UploadStatus: string
{
    case Pending = 'pending';
    case Uploaded = 'uploaded';
    case Ready = 'ready';
    case Rejected = 'rejected';
    case Consumed = 'consumed';
    case Expired = 'expired';
}
