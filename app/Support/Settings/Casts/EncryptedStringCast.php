<?php

declare(strict_types=1);

namespace App\Support\Settings\Casts;

use App\Support\Settings\Groups\SettingsData;
use Illuminate\Support\Facades\Crypt;
use Spatie\LaravelData\Casts\Cast;
use Spatie\LaravelData\Casts\Uncastable;
use Spatie\LaravelData\Support\Creation\CreationContext;
use Spatie\LaravelData\Support\DataProperty;

/**
 * Decrypts a stored (encrypted) string when a settings Data object is created from storage.
 * Strict on purpose: a value that is not valid ciphertext throws instead of being taken as a
 * plain secret, so a rotated `APP_KEY` can never surface garbage as a credential.
 */
final class EncryptedStringCast implements Cast
{
    /**
     * @param  array<string, mixed>  $properties
     * @param  CreationContext<SettingsData>  $context
     */
    public function cast(DataProperty $property, mixed $value, array $properties, CreationContext $context): mixed
    {
        if ($value === null) {
            return null;
        }

        if (! is_string($value)) {
            return Uncastable::create();
        }

        return Crypt::decryptString($value);
    }

    public static function encrypt(?string $value): ?string
    {
        return $value === null ? null : Crypt::encryptString($value);
    }
}
