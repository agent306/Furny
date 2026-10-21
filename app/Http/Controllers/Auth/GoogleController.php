<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Actions\LinkGoogleAccount;
use App\Domain\Identity\Actions\RegisterCustomer;
use App\Domain\Identity\Enums\GoogleIntent;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\GoogleAccountException;
use App\Http\Controllers\Controller;
use App\Listeners\RecordSuccessfulLogin;
use App\Support\Auth\IntendedRedirect;
use App\Support\Auth\RecentAuthentication;
use App\Support\Features;
use App\Support\Settings\Settings;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Laravel\Socialite\AbstractUser;
use Laravel\Socialite\Contracts\User as GoogleUser;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\AbstractProvider;
use Laravel\Socialite\Two\InvalidStateException;
use LogicException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Google sign-in (13 §5.3, 14 §3.2). One round trip serves four purposes, the `GoogleIntent`: signing in or up,
 * linking Google to the signed-in user, confirming the identity of a signed-in user (`recent.auth`), and the Google
 * option of a staff invitation.
 *
 * The flow is Socialite's stateful one (its `state` lives in the session), and the intent lives in the session too:
 * the redirect stores it under `oauth.intent`, the callback takes it from there and from nowhere else. A callback
 * without an intent of the session, with a different intent in its query, or for another user than the one who
 * started the round trip is a state error.
 */
final class GoogleController extends Controller
{
    /** Session keys of one round trip. */
    private const string INTENT_KEY = 'oauth.intent';

    private const string USER_KEY = 'oauth.user';

    /** Session keys of the staff invitation flow (13 §5.9 step 4), set by the invitation page. */
    private const string INVITATION_ID_KEY = 'invitation.id';

    private const string INVITATION_URL_KEY = 'invitation.url';

    /** Session keys the callback leaves for the invitation page. */
    private const string INVITATION_GOOGLE_ID_KEY = 'invitation.google_id';

    private const string INVITATION_GOOGLE_NAME_KEY = 'invitation.google_name';

    public function __construct(
        private readonly LinkGoogleAccount $links,
        private readonly RegisterCustomer $registrations,
        private readonly Settings $settings,
    ) {}

    public function redirect(Request $request): Response
    {
        $this->ensureEnabled();

        $intent = GoogleIntent::from($request->validate([
            'intent' => ['required', Rule::enum(GoogleIntent::class)],
        ])['intent']);
        $user = $this->signedInUser($request);

        if ($intent === GoogleIntent::Login && $user !== null) {
            return IntendedRedirect::response($request);
        }

        if ($intent->needsSignedInUser() && $user === null) {
            throw new AuthenticationException;
        }

        // Somebody who is signed in cannot take the invitation: the page asks them to sign out first.
        abort_if($intent === GoogleIntent::Invitation && ($user !== null || $this->pendingInvitation($request) === null), 403);

        $session = $request->session();
        $session->put(self::INTENT_KEY, $intent->value);
        $session->put(self::USER_KEY, $user?->getKey());

        $provider = Socialite::driver('google');

        if (! $provider instanceof AbstractProvider) {
            throw new LogicException('The Google driver is not an OAuth 2 provider.');
        }

        return $provider
            ->scopes(['openid', 'profile', 'email'])
            ->with(['prompt' => 'select_account'])
            ->redirect();
    }

    public function callback(Request $request): Response
    {
        $this->ensureEnabled();

        // Taken whatever happens next: a round trip is used once.
        $intent = GoogleIntent::tryFrom((string) $request->session()->pull(self::INTENT_KEY));
        $starter = $request->session()->pull(self::USER_KEY);

        if ($request->query->has('error')) {
            return $this->fail($request, $intent, 'auth.errors.oauth_cancelled');
        }

        $user = $this->signedInUser($request);

        if ($intent === null || ! $this->isCurrentRoundTrip($request, $intent, $user, $starter)) {
            return $this->fail($request, $intent, 'auth.errors.oauth_state_invalid');
        }

        if ($intent === GoogleIntent::Login && $user !== null) {
            return IntendedRedirect::response($request);
        }

        try {
            $google = Socialite::driver('google')->user();
        } catch (InvalidStateException) {
            return $this->fail($request, $intent, 'auth.errors.oauth_state_invalid');
        } catch (Throwable $exception) {
            Log::warning('auth.google_failed', ['exception' => $exception::class, 'message' => $exception->getMessage()]);

            return $this->fail($request, $intent, 'auth.errors.oauth_failed');
        }

        $googleId = trim((string) $google->getId());
        $email = mb_strtolower(trim((string) $google->getEmail()));

        if ($googleId === '' || mb_strlen($googleId) > 64) {
            return $this->fail($request, $intent, 'auth.errors.oauth_failed');
        }

        if ($email === '' || ! $this->emailIsVerified($google)) {
            return $this->fail($request, $intent, 'auth.errors.google_email_unverified');
        }

        return match ($intent) {
            GoogleIntent::Login => $this->signInOrUp($request, $google, $googleId, $email),
            GoogleIntent::Link => $this->link($request, $user, $googleId, $email),
            GoogleIntent::Reauthenticate => $this->reauthenticate($request, $user, $googleId),
            GoogleIntent::Invitation => $this->acceptInvitation($request, $google, $googleId, $email),
        };
    }

    private function ensureEnabled(): void
    {
        abort_unless(Features::enabled('google_login'), 404);
    }

    private function signedInUser(Request $request): ?User
    {
        $user = $request->user();

        return $user instanceof User ? $user : null;
    }

    /**
     * Whether the callback belongs to the round trip the session started: the same intent as any the query names,
     * the user who started it, and what the intent needs (a guest to sign in, the invitation still in the session).
     */
    private function isCurrentRoundTrip(Request $request, GoogleIntent $intent, ?User $user, mixed $starter): bool
    {
        $queried = $request->query('intent');

        if ($queried !== null && $queried !== $intent->value) {
            return false;
        }

        return match ($intent) {
            GoogleIntent::Login => $starter === null,
            GoogleIntent::Link, GoogleIntent::Reauthenticate => $user !== null && $starter === $user->getKey(),
            GoogleIntent::Invitation => $user === null && $request->session()->has(self::INVITATION_ID_KEY),
        };
    }

    /** Google must vouch for the address (13 §5.3 step 3): the claim is exactly `true`. */
    private function emailIsVerified(GoogleUser $google): bool
    {
        $raw = $google instanceof AbstractUser ? $google->user : [];

        return ($raw['email_verified'] ?? false) === true;
    }

    /** 13 §5.3 step 4. */
    private function signInOrUp(Request $request, GoogleUser $google, string $googleId, string $email): Response
    {
        $user = User::withTrashed()->where('google_id', $googleId)->first();
        $foundByEmail = false;

        if ($user === null) {
            $user = User::withTrashed()->where('email', $email)->first();
            $foundByEmail = $user !== null;
        }

        if ($user !== null) {
            if ($user->trashed()) {
                return $this->fail($request, GoogleIntent::Login, 'auth.errors.account_pending_deletion');
            }

            if (! $user->is_active) {
                return $this->fail($request, GoogleIntent::Login, 'auth.inactive');
            }

            if ($foundByEmail) {
                try {
                    $this->links->byEmail($user, $googleId);
                } catch (GoogleAccountException $exception) {
                    return $this->fail($request, GoogleIntent::Login, $exception->messageKey());
                }
            }

            return $this->signIn($request, $user);
        }

        // Somebody who was invited as staff is not a customer (13 §5.3).
        if ($this->hasStaffInvitation($email)) {
            return $this->fail($request, GoogleIntent::Login, 'auth.errors.pending_staff_invitation');
        }

        if (! $this->settings->auth()->allowCustomerRegistration) {
            return $this->fail($request, GoogleIntent::Login, 'auth.registration_closed');
        }

        try {
            $user = $this->registrations->fromGoogle($email, $google->getName(), $googleId);
        } catch (UniqueConstraintViolationException) {
            // The same person finished another sign-in with this address a moment ago.
            return $this->fail($request, GoogleIntent::Login, 'auth.errors.oauth_failed');
        }

        return $this->signIn($request, $user);
    }

    /**
     * Customers stay signed in for 14 days; staff never do (13 §5.3 step 5). Staff with a confirmed second factor
     * are not signed in yet: Fortify's challenge reads `login.id` and `login.remember` from the session and finishes
     * the login, as it does after the password form.
     */
    private function signIn(Request $request, User $user): Response
    {
        $session = $request->session();
        $session->put(RecordSuccessfulLogin::PENDING_METHOD_KEY, 'google');

        if ($user->isStaff() && $user->two_factor_confirmed_at !== null) {
            $session->regenerate();
            $session->put(['login.id' => $user->getKey(), 'login.remember' => false]);

            return redirect()->route('two-factor.login');
        }

        Auth::login($user, $user->isCustomer());
        $session->regenerate();

        return IntendedRedirect::response($request);
    }

    /** 13 §5.3 step 6. */
    private function link(Request $request, ?User $user, string $googleId, string $email): Response
    {
        abort_if($user === null, 403);

        try {
            $this->links->forSignedInUser($user, $googleId, $email);
        } catch (GoogleAccountException $exception) {
            return $this->fail($request, GoogleIntent::Link, $exception->messageKey());
        }

        Inertia::flash('success', trans_icu('account.toasts.google_linked'));

        return redirect()->to($this->securityPage($user));
    }

    /** 14 §3.2: the Google account must be the one linked to the user. */
    private function reauthenticate(Request $request, ?User $user, string $googleId): Response
    {
        abort_if($user === null, 403);

        if ($user->google_id === null || $user->google_id !== $googleId) {
            return $this->fail($request, GoogleIntent::Reauthenticate, 'auth.errors.google_email_mismatch');
        }

        $request->session()->put(RecentAuthentication::CONFIRMED_KEY, time());

        return redirect()->to(IntendedRedirect::resolve($request, $user));
    }

    /**
     * 13 §5.9 step 4: the Google address must be the invited one. Nobody is signed in here; the invitation page
     * reads the Google id and the name from the session when the invitee sets a password.
     */
    private function acceptInvitation(Request $request, GoogleUser $google, string $googleId, string $email): Response
    {
        $invitation = $this->pendingInvitation($request);

        if ($invitation === null) {
            return $this->fail($request, GoogleIntent::Invitation, 'auth.errors.oauth_state_invalid');
        }

        if ($invitation->email !== $email) {
            return $this->fail($request, GoogleIntent::Invitation, 'auth.errors.google_email_mismatch');
        }

        $request->session()->put(self::INVITATION_GOOGLE_ID_KEY, $googleId);
        $request->session()->put(self::INVITATION_GOOGLE_NAME_KEY, trim((string) $google->getName()));

        return redirect()->to($this->invitationPage($request));
    }

    /** The invitation of the session while it can still be accepted: not accepted, not revoked, not expired. */
    private function pendingInvitation(Request $request): ?StaffInvitation
    {
        $id = $request->session()->get(self::INVITATION_ID_KEY);

        if (! is_string($id) || $id === '') {
            return null;
        }

        return StaffInvitation::query()
            ->whereKey($id)
            ->whereNull('accepted_at')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();
    }

    /**
     * An invited address must never become a customer. An invitation that has expired but was not revoked can
     * still be sent again, so it counts.
     */
    private function hasStaffInvitation(string $email): bool
    {
        return StaffInvitation::query()
            ->where('email', $email)
            ->whereNull('accepted_at')
            ->whereNull('revoked_at')
            ->exists();
    }

    /** Where a failed round trip lands, with the reason as the error flash (14 §3.2). */
    private function fail(Request $request, ?GoogleIntent $intent, string $messageKey): Response
    {
        $user = $this->signedInUser($request);

        $destination = match (true) {
            $intent === GoogleIntent::Invitation => $this->invitationPage($request),
            $intent?->needsSignedInUser() === true && $user !== null => $this->securityPage($user),
            default => route('login'),
        };

        Inertia::flash('error', trans_icu($messageKey));

        return redirect()->to($destination);
    }

    /** The invitation page the flow started on, when the session still holds a URL of this site; else login. */
    private function invitationPage(Request $request): string
    {
        $url = $request->session()->get(self::INVITATION_URL_KEY);
        $path = is_string($url) ? IntendedRedirect::sameSitePath($request, $url) : null;

        return $path === null ? route('login') : url()->to($path);
    }

    /** The security page of the user's app; the dashboard until that page exists. */
    private function securityPage(User $user): string
    {
        $name = $user->isStaff() ? 'admin.account.security' : 'customer.account.security';

        return route(Route::has($name) ? $name : ($user->isStaff() ? 'admin.dashboard' : 'customer.dashboard'));
    }
}
