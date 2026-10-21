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
use App\Exceptions\RecentAuthenticationRequired;
use App\Http\Controllers\Controller;
use App\Http\Requests\Account\SendPhoneOtpRequest;
use App\Http\Requests\Account\VerifyPhoneRequest;
use App\Support\Auth\RecentAuthentication;
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
        $user = $this->user($request);
        $this->requireRecentAuthentication($request, $user);

        $result = $send->handle($request->string('phone')->toString(), OtpPurpose::VerifyPhone, $request->ip(), $request->captchaToken());

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
        $user = $this->user($request);
        $this->requireRecentAuthentication($request, $user);

        $challenge = OtpChallenge::current(OtpPurpose::VerifyPhone, [OtpChallenge::VERIFY_PHONE]);

        if ($challenge === null) {
            throw new OtpException('otp_expired', 422);
        }

        $verify->handle($challenge->e164, OtpPurpose::VerifyPhone, $request->string('code')->toString(), $request->ip());
        OtpChallenge::forget();

        $phone->handle($user, $challenge->e164);

        Inertia::flash('success', trans_icu('account.toasts.phone_verified'));

        return back();
    }

    /**
     * A user who can already prove who they are (a password, a verified phone, Google) changes their phone only after a
     * recent authentication (13 §6.4; a ruling beyond 13 §5.7): the number is where re-authentication codes go, so
     * without this a stolen session could put in its own number and confirm itself. A user with none of those, who is
     * adding their first way to sign in, is not asked.
     */
    private function requireRecentAuthentication(Request $request, User $user): void
    {
        if (RecentAuthentication::missingFor($user, $request)) {
            throw new RecentAuthenticationRequired;
        }
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        return $user instanceof User ? $user : abort(403);
    }
}
