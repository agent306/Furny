<?php

declare(strict_types=1);

namespace App\Domain\Messaging\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `messages.kind` (02 §9.1): `internal_note` is visible to staff only; `system` is written by the order events. */
#[TypeScript]
enum MessageKind: string
{
    case Text = 'text';
    case System = 'system';
    case InternalNote = 'internal_note';
}
