<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Concerns\ProfileValidationRules;
use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Events\CustomerRegistered;
use App\Domain\Identity\Models\User;
use App\Rules\TurnstileToken;
use App\Support\Settings\Settings;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\CreatesNewUsers;

/**
 * Registration with email and password (13 §5.1). The new customer starts with the business defaults for time
 * zone and units, has accepted the terms (the form made them), and has no onboarding yet.
 */
final class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules, ProfileValidationRules;

    public function __construct(private readonly Settings $settings) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public function create(array $input): User
    {
        $input = $this->normalise($input);

        $validated = Validator::make($input, [
            ...$this->profileRules(),
            // A name is shown to staff and in messages: no links in it (a spam registration).
            'name' => [...$this->nameRules(), 'not_regex:/(https?:\/\/|www\.)/i'],
            'password' => $this->passwordRules(),
            'terms' => ['accepted'],
            'marketing_opt_in' => ['boolean'],
            'cf_turnstile_response' => [new TurnstileToken('register', failOpen: true)],
        ], [
            'name.not_regex' => __('auth.name_no_links'),
            'email.unique' => __('auth.email_unavailable'),
            'terms.accepted' => __('auth.terms_required'),
        ])->validate();

        $units = $this->settings->units();

        $user = new User([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => $validated['password'],
            'timezone' => $this->settings->business()->timezone,
            'unit_system' => UnitSystem::from($units->defaultSystem),
            'length_unit' => LengthUnit::from($units->defaultLengthUnit),
            'locale' => (string) config('app.locale'),
            'marketing_opt_in' => (bool) $validated['marketing_opt_in'],
        ]);
        $user->type = UserType::Customer;
        $user->terms_accepted_at = now();
        $user->save();

        CustomerRegistered::dispatch($user);

        return $user;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function normalise(array $input): array
    {
        $input['name'] = is_string($input['name'] ?? null) ? trim($input['name']) : ($input['name'] ?? null);
        $input['email'] = is_string($input['email'] ?? null) ? mb_strtolower(trim($input['email'])) : ($input['email'] ?? null);
        // A checkbox that is not ticked is not sent.
        $input['marketing_opt_in'] = filter_var($input['marketing_opt_in'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return $input;
    }
}
