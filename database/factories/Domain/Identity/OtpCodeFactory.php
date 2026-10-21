<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Identity;

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * Default: a fresh WhatsApp login code `123456` for a generated phone number.
 *
 * @extends Factory<OtpCode>
 */
final class OtpCodeFactory extends Factory
{
    protected $model = OtpCode::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'phone_e164' => '+919'.fake()->numerify('#########'),
            'purpose' => OtpPurpose::Login,
            'channel' => OtpChannel::Whatsapp,
            'code_hash' => Hash::make('123456'),
            'attempts' => 0,
            'expires_at' => now()->addMinutes(10),
            'consumed_at' => null,
            'ip' => null,
        ];
    }

    public function forPhone(string $e164, string $code = '123456'): static
    {
        return $this->state(['phone_e164' => $e164])->withCode($code);
    }

    public function withCode(string $code): static
    {
        return $this->state(fn (): array => ['code_hash' => Hash::make($code)]);
    }

    public function verifyPhone(): static
    {
        return $this->state(['purpose' => OtpPurpose::VerifyPhone]);
    }

    public function sms(): static
    {
        return $this->state(['channel' => OtpChannel::Sms]);
    }

    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subMinute()]);
    }

    public function consumed(): static
    {
        return $this->state(fn (): array => ['consumed_at' => now()]);
    }

    public function attempts(int $attempts): static
    {
        return $this->state(['attempts' => $attempts]);
    }
}
