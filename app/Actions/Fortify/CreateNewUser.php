<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Concerns\ProfileValidationRules;
use App\Domain\Identity\Actions\RegisterCustomer;
use App\Domain\Identity\Models\User;
use App\Rules\TurnstileToken;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\CreatesNewUsers;

/**
 * Registration with email and password (13 §5.1): validates the form, then `RegisterCustomer` creates the customer
 * (business defaults, terms accepted, no onboarding yet).
 */
final class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules, ProfileValidationRules;

    public function __construct(private readonly RegisterCustomer $customers) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public function create(array $input): User
    {
        $input = $this->normalise($input);

        $validated = Validator::make($input, [
            ...$this->profileRules(),
            // A name is shown to staff and in messages: no links in it (a spam registration).
            'name' => [...$this->nameRules(), 'not_regex:'.RegisterCustomer::NAME_LINK_PATTERN],
            'password' => $this->passwordRules(),
            'terms' => ['accepted'],
            'marketing_opt_in' => ['boolean'],
            'cf_turnstile_response' => [new TurnstileToken('register', failOpen: true)],
        ], [
            'name.not_regex' => __('auth.name_no_links'),
            'email.unique' => __('auth.email_unavailable'),
            'terms.accepted' => __('auth.terms_required'),
        ])->validate();

        return $this->customers->create(
            name: $validated['name'],
            email: $validated['email'],
            password: $validated['password'],
            marketingOptIn: (bool) $validated['marketing_opt_in'],
        );
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
