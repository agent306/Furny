<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpChannelResolver;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Props of `Customer/Account/Profile` and `Admin/Account/Profile` (10 §13.2, 11 §18, 14 §9). */
#[TypeScript]
final class AccountProfileProps extends Data
{
    /**
     * @param  list<OtpChannel>  $otpChannels  The channels a code to a new phone number can go out on.
     */
    public function __construct(
        public AuthUserData $user,
        public bool $marketingOptIn,
        public array $otpChannels,
    ) {}

    public static function fromUser(User $user, OtpChannelResolver $channels): self
    {
        return new self(
            user: AuthUserData::fromUser($user),
            marketingOptIn: $user->marketing_opt_in,
            // The number is not known yet (it is what the dialog asks for): the channels that are configured.
            otpChannels: $channels->available(''),
        );
    }
}
