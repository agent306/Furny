<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Actions\ResolvePhoneAccount;
use App\Domain\Identity\Actions\SendOtp;
use App\Domain\Identity\Actions\VerifyOtp;
use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Otp\OtpChallenge;
use App\Domain\Identity\Otp\OtpChannelResolver;
use App\Domain\Identity\Otp\OtpLimits;
use App\Domain\Identity\Support\PhoneAccountOutcome;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\CompleteOtpSignupRequest;
use App\Http\Requests\Auth\ResendOtpRequest;
use App\Http\Requests\Auth\SendOtpRequest;
use App\Http\Requests\Auth\VerifyOtpRequest;
use App\Listeners\RecordSuccessfulLogin;
use App\Support\Auth\AuthPageProps;
use App\Support\Auth\IntendedRedirect;
use App\Support\Http\OtpErrorResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sign-in and sign-up with a phone code (13 §5.2, 14 §3.2). The flow is the same for a number that has an account and
 * one that has none: a code is sent either way, and only after it is verified does the number lead to a sign-in, a
 * name to ask for, or a refusal. Nothing before that looks the number up, so nothing before that tells.
 *
 * The routes are for guests, except the status poll. What a step needs of the one before is in the session: the
 * challenge (`OtpChallenge`) until the code is verified, then, for a number without an account, the verified number
 * for 15 minutes (`otp.verified_phone`) while the visitor gives their name.
 */
final class PhoneOtpController extends Controller
{
    /** The intents of the pages that start here; the challenge of another flow in the session is not theirs. */
    private const array INTENTS = [OtpChallenge::LOGIN, OtpChallenge::REGISTER];

    public function create(Request $request): InertiaResponse
    {
        return Inertia::render('Auth/PhoneLogin', [
            ...AuthPageProps::make(),
            'intent' => $request->query('intent') === OtpChallenge::REGISTER ? OtpChallenge::REGISTER : OtpChallenge::LOGIN,
        ]);
    }

    public function send(SendOtpRequest $request, SendOtp $send): RedirectResponse
    {
        $intent = $request->string('intent')->toString();

        $result = $send->handle($request->string('phone')->toString(), OtpPurpose::Login, $request->ip(), $this->captcha($request));

        $request->session()->forget(OtpChallenge::VERIFIED_PHONE_KEY);
        OtpChallenge::start($result, OtpPurpose::Login, $intent, $intent === OtpChallenge::REGISTER ? $request->string('name')->toString() : null);
        Inertia::flash(['channel' => $result->channel->value, 'maskedPhone' => $result->maskedPhone]);

        return redirect()->route('auth.otp.verify.show');
    }

    public function showVerify(OtpChannelResolver $channels): InertiaResponse|RedirectResponse
    {
        $challenge = OtpChallenge::current(OtpPurpose::Login, self::INTENTS);

        if ($challenge === null) {
            return redirect()->route('auth.otp.create');
        }

        return Inertia::render('Auth/PhoneVerify', [
            ...AuthPageProps::make(),
            'channel' => $challenge->channel->value,
            'maskedPhone' => $challenge->maskedPhone(),
            'resendAvailableIn' => $challenge->resendAvailableIn(),
            'channels' => array_map(static fn (OtpChannel $channel): string => $channel->value, $channels->available($challenge->e164)),
        ]);
    }

    public function verify(VerifyOtpRequest $request, VerifyOtp $verify, ResolvePhoneAccount $accounts): Response
    {
        $challenge = OtpChallenge::current(OtpPurpose::Login, self::INTENTS);

        if ($challenge === null) {
            return redirect()->route('auth.otp.create');
        }

        $verify->handle($challenge->e164, OtpPurpose::Login, $request->string('code')->toString(), $request->ip());

        // The code is used up: whatever comes next, this challenge is over.
        OtpChallenge::forget();

        $outcome = $accounts->handle($challenge->e164, $challenge->intent === OtpChallenge::REGISTER ? $challenge->name : null);

        if ($outcome->asksForName()) {
            $request->session()->put(OtpChallenge::VERIFIED_PHONE_KEY, ['phone' => $challenge->e164, 'at' => now()->getTimestamp()]);

            return redirect()->route('auth.otp.complete.show');
        }

        return $this->conclude($request, $outcome);
    }

    public function resend(ResendOtpRequest $request, SendOtp $send): RedirectResponse
    {
        $challenge = OtpChallenge::current(OtpPurpose::Login, self::INTENTS);

        if ($challenge === null) {
            return redirect()->route('auth.otp.create');
        }

        $result = $send->handle($challenge->e164, OtpPurpose::Login, $request->ip(), $this->captcha($request), $request->channel());

        $challenge->followedBy($result);
        Inertia::flash(['channel' => $result->channel->value, 'maskedPhone' => $result->maskedPhone]);

        return back();
    }

    /**
     * What the verify page polls while the code went by WhatsApp (13 §4.2): the channel of the latest live code and
     * whether it is an SMS that replaced a WhatsApp one that was not delivered. The challenge follows the replacement.
     */
    public function status(): JsonResponse
    {
        $challenge = OtpChallenge::current(OtpPurpose::Login, self::INTENTS)
            ?? OtpChallenge::current(OtpPurpose::VerifyPhone, [OtpChallenge::VERIFY_PHONE]);

        if ($challenge === null) {
            return response()->json(['code' => 'no_challenge'], 404);
        }

        $latest = OtpCode::query()
            ->where('phone_e164', $challenge->e164)
            ->where('purpose', $challenge->purpose)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->latest('created_at')
            ->latest('id')
            ->first();

        if ($latest !== null && $latest->id !== $challenge->otpId) {
            $challenge = $challenge->following($latest);
        }

        return response()->json([
            'channel' => $challenge->channel->value,
            'fallbackSent' => $challenge->channel === OtpChannel::Sms && Cache::get(OtpLimits::fallbackKey($challenge->e164)) === OtpChannel::Sms->value,
        ]);
    }

    public function showComplete(): InertiaResponse|RedirectResponse
    {
        $phone = $this->verifiedPhone();

        if ($phone === null) {
            return redirect()->route('auth.otp.create');
        }

        return Inertia::render('Auth/PhoneComplete', [
            ...AuthPageProps::make(),
            'maskedPhone' => OtpChallenge::mask($phone),
        ]);
    }

    public function complete(CompleteOtpSignupRequest $request, ResolvePhoneAccount $accounts): Response
    {
        $phone = $this->verifiedPhone();

        if ($phone === null) {
            $request->session()->forget(OtpChallenge::VERIFIED_PHONE_KEY);

            return redirect()->route('auth.otp.create')
                ->withErrors(OtpErrorResponse::bag('otp_expired', field: 'phone'));
        }

        return $this->conclude($request, $accounts->handle($phone, $request->string('name')->toString()));
    }

    /**
     * Signs the account in, or sends the visitor to the login page with the reason they cannot sign in. Customers stay
     * signed in for 14 days (13 §5.2). The method is named for the `Login` event before it fires, and the session id is
     * renewed after it.
     */
    private function conclude(Request $request, PhoneAccountOutcome $outcome): Response
    {
        $session = $request->session();
        $session->forget(OtpChallenge::VERIFIED_PHONE_KEY);

        if ($outcome->user === null) {
            Inertia::flash('error', trans_icu($outcome->refusal ?? 'auth.errors.otp_failed'));

            return redirect()->route('login');
        }

        $user = $outcome->user;
        $session->put(RecordSuccessfulLogin::PENDING_METHOD_KEY, ['method' => 'otp', 'user' => $user->getKey()]);
        Auth::login($user, $user->isCustomer());
        $session->regenerate();

        return IntendedRedirect::response($request);
    }

    /** The number verified without an account, while the 15 minutes to name it last. */
    private function verifiedPhone(): ?string
    {
        $verified = session(OtpChallenge::VERIFIED_PHONE_KEY);

        if (! is_array($verified) || ! is_string($verified['phone'] ?? null) || ! is_int($verified['at'] ?? null)) {
            return null;
        }

        return now()->getTimestamp() - $verified['at'] <= OtpChallenge::VERIFIED_PHONE_MINUTES * 60 ? $verified['phone'] : null;
    }

    private function captcha(Request $request): ?string
    {
        $token = $request->input('cf_turnstile_response');

        return is_string($token) ? $token : null;
    }
}
