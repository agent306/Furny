<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Actions\VerifyOtp;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpChallenge;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Domain\Identity\Otp\OtpException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ReauthenticateRequest;
use App\Support\Auth\AuthPageProps;
use App\Support\Auth\IntendedRedirect;
use App\Support\Auth\RecentAuthentication;
use App\Support\Features;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;

/**
 * Confirming who is at the keyboard before a sensitive action, for a user who has no password to confirm (13 §6.4,
 * 14 §3.2): a code to their verified phone, or Google. Success stamps `auth.password_confirmed_at`, which is what
 * `recent.auth` reads, and returns to the page they were sent away from.
 */
final class ReauthenticateController extends Controller
{
    public function show(Request $request, OtpChannelResolver $channels): InertiaResponse|RedirectResponse
    {
        $user = $this->user($request);

        if ($user->hasPassword()) {
            return redirect()->route('password.confirm');
        }

        $phone = $this->verifiedPhone($user);

        return Inertia::render('Auth/Reauthenticate', [
            ...AuthPageProps::make(),
            'maskedPhone' => $phone === null ? null : OtpChallenge::mask($phone),
            'phoneAvailable' => $phone !== null && $channels->available($phone) !== [],
            'googleLinked' => $user->google_id !== null,
            'googleEnabled' => Features::enabled('google_login'),
        ]);
    }

    public function store(ReauthenticateRequest $request, SendOtp $send, VerifyOtp $verify): RedirectResponse
    {
        $user = $request->userOrFail();
        $phone = $this->verifiedPhone($user);

        if ($phone === null) {
            throw new OtpException('reauth_no_phone', 422);
        }

        if ($request->step() === 'send') {
            $token = $request->input('cf_turnstile_response');
            $result = $send->handle($phone, OtpPurpose::Login, $request->ip(), is_string($token) ? $token : null);

            OtpChallenge::start($result, OtpPurpose::Login, OtpChallenge::REAUTHENTICATE);
            Inertia::flash('info', trans_icu('auth_ui.reauth.sent', ['channel' => $result->channel->value, 'phone' => $result->maskedPhone]));

            return back();
        }

        // Only a code that was asked for here, for this user's number, confirms them.
        $challenge = OtpChallenge::current(OtpPurpose::Login, [OtpChallenge::REAUTHENTICATE]);

        if ($challenge === null || $challenge->e164 !== $phone) {
            throw new OtpException('otp_expired', 422);
        }

        $verify->handle($phone, OtpPurpose::Login, $request->string('code')->toString(), $request->ip());

        OtpChallenge::forget();
        $request->session()->put(RecentAuthentication::CONFIRMED_KEY, now()->getTimestamp());

        return redirect()->to(IntendedRedirect::resolve($request, $user));
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        return $user instanceof User ? $user : abort(403);
    }

    /** The user's phone number when it is verified: the only one a confirmation code may go to. */
    private function verifiedPhone(User $user): ?string
    {
        return $user->phone_e164 !== null && $user->phone_verified_at !== null ? $user->phone_e164 : null;
    }
}
