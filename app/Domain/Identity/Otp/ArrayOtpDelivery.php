<?php

declare(strict_types=1);

namespace App\Domain\Identity\Otp;

use App\Domain\Identity\Enums\OtpChannel;

/** The delivery of the Feature test suite (tests/Pest.php): keeps what was sent in memory, and can be told to refuse a channel. */
final class ArrayOtpDelivery implements OtpDelivery
{
    /** @var list<array{channel: OtpChannel, e164: string, message: string, otpId: string}> */
    private array $sent = [];

    /** @var list<OtpChannel> */
    private array $failing = [];

    public function send(OtpChannel $channel, string $e164, string $message, string $otpId): void
    {
        if (in_array($channel, $this->failing, true)) {
            throw new OtpDeliveryException("The {$channel->value} channel refused the message.");
        }

        $this->sent[] = ['channel' => $channel, 'e164' => $e164, 'message' => $message, 'otpId' => $otpId];
    }

    /** From now on these channels throw `OtpDeliveryException`. */
    public function failOn(OtpChannel ...$channels): self
    {
        $this->failing = array_values($channels);

        return $this;
    }

    /** @return list<array{channel: OtpChannel, e164: string, message: string, otpId: string}> */
    public function sent(): array
    {
        return $this->sent;
    }

    /** The six digits of the last message sent, or null when nothing was sent. */
    public function lastCode(): ?string
    {
        $last = $this->sent === [] ? null : $this->sent[array_key_last($this->sent)];

        return $last !== null && preg_match('/\b\d{6}\b/', $last['message'], $match) === 1 ? $match[0] : null;
    }
}
