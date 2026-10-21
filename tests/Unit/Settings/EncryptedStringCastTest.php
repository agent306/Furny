<?php

declare(strict_types=1);

use App\Support\Settings\Attributes\Encrypted;
use App\Support\Settings\Groups\SettingsData;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;

/**
 * Test-only settings group with a secret (13 §15: v1 stores none, the mechanism is unit-tested).
 */
final class SecretSettings extends SettingsData
{
    public function __construct(
        #[Encrypted]
        public ?string $apiKey,
        public string $label,
    ) {}

    public static function defaults(): static
    {
        return new self(null, 'default');
    }
}

it('encrypts #[Encrypted] properties in storage and decrypts them when created from storage', function (): void {
    $storage = (new SecretSettings('secret', 'visible'))->toStorage();

    expect($storage['api_key'])->not->toBe('secret')
        ->and(Crypt::decryptString($storage['api_key']))->toBe('secret')
        ->and($storage['label'])->toBe('visible')
        ->and(SecretSettings::from($storage)->apiKey)->toBe('secret');
});

it('keeps a null secret null and leaves the wire format to the caller', function (): void {
    $settings = new SecretSettings(null, 'x');

    expect($settings->toStorage()['api_key'])->toBeNull()
        ->and(SecretSettings::from($settings->toStorage())->apiKey)->toBeNull();
});

it('produces a different ciphertext on every encryption', function (): void {
    $settings = new SecretSettings('secret', 'x');

    expect($settings->toStorage()['api_key'])->not->toBe($settings->toStorage()['api_key']);
});

it('refuses a stored value that is not valid ciphertext instead of using it as the secret', function (): void {
    SecretSettings::from(['api_key' => 'plain-text', 'label' => 'x']);
})->throws(DecryptException::class);
