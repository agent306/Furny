<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Identity\OtpCodeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * 02 §1.3. `code_hash` is `Hash::make` of the 6-digit code; the plain code is never stored.
 *
 * @property string $id
 * @property string $phone_e164
 * @property OtpPurpose $purpose
 * @property OtpChannel $channel
 * @property string $code_hash
 * @property int $attempts
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $consumed_at
 * @property string|null $ip
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Fillable(['phone_e164', 'purpose', 'channel', 'code_hash', 'attempts', 'expires_at', 'consumed_at', 'ip'])]
#[Hidden(['code_hash'])]
final class OtpCode extends Model
{
    /** @use HasFactory<OtpCodeFactory> */
    use HasFactory, HasUlids;

    /** How long a code can be used (13 §4.1). */
    public const int LIFETIME_MINUTES = 10;

    /** Wrong guesses a code survives; the next attempt kills it. */
    public const int MAX_ATTEMPTS = 5;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purpose' => OtpPurpose::class,
            'channel' => OtpChannel::class,
            'attempts' => 'int',
            'expires_at' => 'immutable_datetime',
            'consumed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function newFactory(): OtpCodeFactory
    {
        return OtpCodeFactory::new();
    }
}
