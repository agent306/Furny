<?php

declare(strict_types=1);

namespace App\Domain\Ai\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `blueprint_imports.ai_provider` and the AI settings provider (02 §4.1, 18). */
#[TypeScript]
enum AiProvider: string
{
    case Anthropic = 'anthropic';
    case Openai = 'openai';
    case OpenaiCompatible = 'openai_compatible';
    case None = 'none';
}
