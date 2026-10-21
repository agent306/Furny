<?php

declare(strict_types=1);

namespace App\Domain\Ai\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `ai_usage_events.feature` (02 §7.2): `provider_test` is the admin "Test connection" call (18 §5.3). */
#[TypeScript]
enum AiFeature: string
{
    case BlueprintRecognition = 'blueprint_recognition';
    case ProviderTest = 'provider_test';
}
