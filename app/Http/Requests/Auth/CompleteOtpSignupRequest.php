<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Domain\Identity\Actions\RegisterCustomer;
use Illuminate\Foundation\Http\FormRequest;

/** `auth.otp.complete` (14 §3.2): the name of the customer whose number was verified, and the terms. */
final class CompleteOtpSignupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:120', 'not_regex:'.RegisterCustomer::NAME_LINK_PATTERN],
            'terms' => ['accepted'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'name.not_regex' => __('auth.name_no_links'),
            'terms.accepted' => __('auth.terms_required'),
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
