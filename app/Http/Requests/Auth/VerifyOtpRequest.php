<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `auth.otp.verify` (14 §3.2): the code as typed. `VerifyOtp` normalises it; a code that is not six digits is
 * `otp_invalid` without costing an attempt.
 */
final class VerifyOtpRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['code' => ['required', 'string', 'max:12']];
    }
}
