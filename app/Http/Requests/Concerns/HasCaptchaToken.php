<?php

declare(strict_types=1);

namespace App\Http\Requests\Concerns;

/** The Turnstile answer (`cf_turnstile_response`) of a form that sends a phone code; `SendOtp` judges it (13 §4.2 step 3). */
trait HasCaptchaToken
{
    public function captchaToken(): ?string
    {
        $token = $this->input('cf_turnstile_response');

        return is_string($token) ? $token : null;
    }
}
