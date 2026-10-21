<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\ContactVerification;
use App\Support\Settings\Settings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use SensitiveParameter;

/**
 * Creates a customer account (13 §5.1, §5.2, §5.3). The one place that gives a new customer the business defaults
 * for time zone, units and language, the accepted terms and no onboarding yet; the registration form, Google and
 * (later) the phone sign-up all come through here.
 */
final class RegisterCustomer
{
    /** A name with a web address in it is spam (13 §5.1); the form refuses it and Google's is not taken as is. */
    public const string NAME_LINK_PATTERN = '/(https?:\/\/|www\.)/i';

    public const int NAME_MAX = 120;

    public function __construct(
        private readonly Settings $settings,
        private readonly ContactVerification $contacts,
    ) {}

    /**
     * The customer is saved with the terms accepted (the form or the button they pressed said so) and
     * `CustomerRegistered` is dispatched after commit. `$emailVerified` is for an address someone else vouched for,
     * `$verifiedPhone` (E.164) for a number whose owner just proved it with a code. `$email` is already trimmed and
     * lower-cased; an account has an email or a phone, or both.
     */
    public function create(
        string $name,
        ?string $email,
        #[SensitiveParameter] ?string $password = null,
        bool $marketingOptIn = false,
        ?string $googleId = null,
        bool $emailVerified = false,
        ?string $verifiedPhone = null,
    ): User {
        $units = $this->settings->units();

        return DB::transaction(function () use ($name, $email, $password, $marketingOptIn, $googleId, $emailVerified, $verifiedPhone, $units): User {
            $user = new User([
                'name' => $name,
                'email' => $email,
                'phone_e164' => $verifiedPhone,
                'timezone' => $this->settings->business()->timezone,
                'unit_system' => UnitSystem::from($units->defaultSystem),
                'length_unit' => LengthUnit::from($units->defaultLengthUnit),
                'locale' => (string) config('app.locale'),
                'marketing_opt_in' => $marketingOptIn,
                ...($password === null ? [] : ['password' => $password]),
            ]);
            $user->type = UserType::Customer;
            $user->google_id = $googleId;
            $user->terms_accepted_at = now();
            $user->save();

            if ($emailVerified) {
                $this->contacts->markEmailVerified($user);
            }

            if ($verifiedPhone !== null) {
                $this->contacts->markPhoneVerified($user);
            }

            CustomerRegistered::dispatch($user);

            return $user;
        });
    }

    /**
     * A customer who signed up with a phone code (13 §5.2). The number is verified, which announces the user's first
     * verified contact; there is no email and no password, and the terms are accepted (the form said so before the
     * code was sent). The caller has seen to it that nobody has the number, and treats a unique violation (a sign-up
     * with the same number that finished a moment ago) as having an account.
     */
    public function fromPhone(string $e164, string $name): User
    {
        return $this->create(trim($name), null, verifiedPhone: $e164);
    }

    /**
     * A customer who signed up with Google (13 §5.3 step 4). Google verified the address, so it is verified here,
     * which also announces the user's first verified contact. There is no password, and the avatar is not imported
     * (no third-party image fetch). Google's name goes through the form's rule for names: one with a web address in
     * it, or none, is replaced by the part of the address before the `@`.
     */
    public function fromGoogle(string $email, ?string $name, string $googleId): User
    {
        $name = trim((string) $name);

        if ($name === '' || preg_match(self::NAME_LINK_PATTERN, $name) === 1) {
            $name = Str::before($email, '@');
        }

        return $this->create(mb_substr($name, 0, self::NAME_MAX), $email, googleId: $googleId, emailVerified: true);
    }
}
