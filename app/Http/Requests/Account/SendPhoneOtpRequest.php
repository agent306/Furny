<?php

declare(strict_types=1);

namespace App\Http\Requests\Account;

use App\Http\Requests\Concerns\HasCaptchaToken;
use Illuminate\Foundation\Http\FormRequest;

/** `account.phone.send` (14 §3.3): the number to add; `SendOtp` judges it (country, type) and the captcha. */
final class SendPhoneOtpRequest extends FormRequest
{
    use HasCaptchaToken;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', 'max:32'],
            'cf_turnstile_response' => ['nullable', 'string'],
        ];
    }
}
