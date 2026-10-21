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

/**
 * Creates a customer account outside the registration form (13 §5.2, §5.3). The account starts with the business
 * defaults for time zone and units, like the form's (13 §5.1).
 */
final class RegisterCustomer
{
    private const int NAME_MAX = 120;

    public function __construct(
        private readonly Settings $settings,
        private readonly ContactVerification $contacts,
    ) {}

    /**
     * A customer who signed up with Google (13 §5.3 step 4). Google verified the address, so it is verified here,
     * which also announces the user's first verified contact. The button they pressed carries the terms caption, so
     * the terms are accepted. There is no password, and the avatar is not imported (no third-party image fetch).
     * `$email` is already trimmed and lower-cased.
     */
    public function fromGoogle(string $email, ?string $name, string $googleId): User
    {
        $units = $this->settings->units();
        $name = trim((string) $name);
        $name = Str::limit($name === '' ? Str::before($email, '@') : $name, self::NAME_MAX, '');

        return DB::transaction(function () use ($email, $name, $googleId, $units): User {
            $user = new User([
                'name' => $name,
                'email' => $email,
                'timezone' => $this->settings->business()->timezone,
                'unit_system' => UnitSystem::from($units->defaultSystem),
                'length_unit' => LengthUnit::from($units->defaultLengthUnit),
                'locale' => (string) config('app.locale'),
                'marketing_opt_in' => false,
            ]);
            $user->type = UserType::Customer;
            $user->google_id = $googleId;
            $user->terms_accepted_at = now();
            $user->save();

            $this->contacts->markEmailVerified($user);

            CustomerRegistered::dispatch($user);

            return $user;
        });
    }
}
