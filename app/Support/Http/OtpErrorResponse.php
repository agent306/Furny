<?php

declare(strict_types=1);

namespace App\Support\Http;

use App\Domain\Identity\Otp\OtpException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Lang;

/**
 * Renders `OtpException` (13 §4, 14 §1.9). Machines get the status of the refusal and `{code, ...context}`. An Inertia
 * visit or a plain form is sent back to the form with the errors bag of 14 §1.9: the message under the field the
 * refusal belongs to, the machine code under `code` and the context (`retryAfter`, `attemptsLeft`) as strings.
 *
 * The field is the code input for the verify-side refusals, the captcha field for the captcha ones, and `phone` for
 * the rest. The code input is itself called `code`, so a refusal that belongs to it carries its machine code under
 * `reason` instead. A refusal that makes the visitor wait also carries the wait as `rate_limited`, the error the
 * auth pages count down inline (`RateLimitedResponse::INLINE_ERROR`).
 */
final class OtpErrorResponse
{
    /** Refusals about the code the visitor typed. */
    private const array CODE_FIELD = ['otp_invalid', 'otp_expired', 'otp_too_many_attempts', 'phone_unavailable', 'reauth_no_phone'];

    /** Refusals about the captcha. */
    private const array CAPTCHA_FIELD = ['captcha_required', 'captcha_unavailable'];

    public static function render(OtpException $exception, Request $request): JsonResponse|RedirectResponse
    {
        if (ErrorPage::wantsMachineResponse($request)) {
            $headers = isset($exception->context['retryAfter']) ? ['Retry-After' => (string) $exception->context['retryAfter']] : [];

            return response()->json(['code' => $exception->errorCode, ...$exception->context], $exception->status, $headers);
        }

        return back()->withErrors(self::bag($exception->errorCode, $exception->context));
    }

    /**
     * The errors bag of a refusal, for the page (14 §1.9).
     *
     * @param  array<string, int|string>  $context
     * @return array<string, string>
     */
    public static function bag(string $code, array $context = [], ?string $field = null): array
    {
        $field ??= match (true) {
            in_array($code, self::CODE_FIELD, true) => 'code',
            in_array($code, self::CAPTCHA_FIELD, true) => 'cf_turnstile_response',
            default => 'phone',
        };

        $bag = [$field => self::message($code, $context), $field === 'code' ? 'reason' : 'code' => $code];

        foreach ($context as $key => $value) {
            $bag[$key] = (string) $value;
        }

        if (isset($context['retryAfter'])) {
            $bag[RateLimitedResponse::INLINE_ERROR] = (string) $context['retryAfter'];
        }

        return $bag;
    }

    /**
     * `auth.errors.{code}`; the wrong-code message counts the attempts left.
     *
     * @param  array<string, int|string>  $context
     */
    public static function message(string $code, array $context = []): string
    {
        if ($code === 'otp_invalid') {
            $left = (int) ($context['attemptsLeft'] ?? 0);

            return trans_choice('auth.errors.otp_invalid', $left, ['attemptsLeft' => $left]);
        }

        $key = 'auth.errors.'.$code;

        return Lang::has($key) ? __($key) : __('auth.errors.otp_failed');
    }
}
