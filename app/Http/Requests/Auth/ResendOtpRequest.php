<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Domain\Identity\Enums\OtpChannel;
use App\Http\Requests\Concerns\HasCaptchaToken;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** `auth.otp.resend` (14 §3.2): the channel the person prefers, if they chose one, and the captcha answer. */
final class ResendOtpRequest extends FormRequest
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
            'channel' => ['nullable', Rule::enum(OtpChannel::class)],
            'cf_turnstile_response' => ['nullable', 'string'],
        ];
    }

    public function channel(): ?OtpChannel
    {
        return OtpChannel::tryFrom((string) $this->input('channel'));
    }
}
