<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Domain\Identity\Actions\RegisterCustomer;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `auth.otp.send` (14 §3.2): the number, and what the code is for. The number itself is judged by `SendOtp`, which
 * knows the allowed countries (`phone_invalid`, `phone_not_mobile`, `phone_country_not_supported`). A sign-up also
 * gives its name and accepts the terms here, so that a new number can be signed up without asking again.
 */
final class SendOtpRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', 'max:32'],
            'intent' => ['required', Rule::in(['login', 'register'])],
            'name' => ['exclude_unless:intent,register', 'required_if:intent,register', 'string', 'min:2', 'max:120', 'not_regex:'.RegisterCustomer::NAME_LINK_PATTERN],
            'terms' => ['exclude_unless:intent,register', 'accepted_if:intent,register'],
            'cf_turnstile_response' => ['nullable', 'string'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'name.not_regex' => __('auth.name_no_links'),
            'terms.accepted_if' => __('auth.terms_required'),
        ];
    }

    protected function prepareForValidation(): void
    {
        $name = $this->input('name');

        if (is_string($name)) {
            $this->merge(['name' => trim($name)]);
        }
    }
}
