<?php

declare(strict_types=1);

namespace App\Http\Controllers\Account;

use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Actions\VerifyOtp;
use App\Domain\Identity\Actions\VerifyPhone;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpChallenge;
use App\Domain\Identity\Otp\OtpException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Account\SendPhoneOtpRequest;
use App\Http\Requests\Account\VerifyPhoneRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;

/**
 * Adding or changing the phone number of the signed-in user, customer or staff (13 §5.7, 14 §3.3): a code to the new
 * number (purpose `verify_phone`), then the number is theirs. Whether somebody else has it is answered only after the
 * code (`VerifyPhone`).
 */
final class PhoneController extends Controller
{
    public function send(SendPhoneOtpRequest $request, SendOtp $send): RedirectResponse
    {
        $token = $request->input('cf_turnstile_response');
        $result = $send->handle($request->string('phone')->toString(), OtpPurpose::VerifyPhone, $request->ip(), is_string($token) ? $token : null);

        OtpChallenge::start($result, OtpPurpose::VerifyPhone, OtpChallenge::VERIFY_PHONE);
        Inertia::flash([
            'info' => trans_icu('account.otp_sent', ['channel' => $result->channel->value, 'phone' => $result->maskedPhone]),
            'channel' => $result->channel->value,
            'maskedPhone' => $result->maskedPhone,
        ]);

        return back();
    }

    public function verify(VerifyPhoneRequest $request, VerifyOtp $verify, VerifyPhone $phone): RedirectResponse
    {
        $challenge = OtpChallenge::current(OtpPurpose::VerifyPhone, [OtpChallenge::VERIFY_PHONE]);

        if ($challenge === null) {
            throw new OtpException('otp_expired', 422);
        }

        $verify->handle($challenge->e164, OtpPurpose::VerifyPhone, $request->string('code')->toString(), $request->ip());
        OtpChallenge::forget();

        $phone->handle($this->user($request), $challenge->e164);

        Inertia::flash('success', trans_icu('account.toasts.phone_verified'));

        return back();
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        return $user instanceof User ? $user : abort(403);
    }
}
