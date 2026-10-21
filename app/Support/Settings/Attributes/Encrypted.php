<?php

declare(strict_types=1);

namespace App\Support\Settings\Attributes;

use App\Support\Settings\Casts\EncryptedStringCast;
use Attribute;
use Spatie\LaravelData\Attributes\WithCast;

/**
 * Marks a top-level string property of a settings Data class as a secret (13 §15): `toStorage()`
 * encrypts it, creating the object from stored data decrypts it, and `toWire()` omits it. Redacting it in audit logs
 * (13 §15) is enforced by the audit task, not here.
 * v1 stores no secrets in settings (all secrets are env); the mechanism exists for future use.
 */
#[Attribute(Attribute::TARGET_PROPERTY)]
final class Encrypted extends WithCast
{
    public function __construct()
    {
        parent::__construct(EncryptedStringCast::class);
    }
}
