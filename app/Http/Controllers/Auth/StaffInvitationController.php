<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Actions\AcceptStaffInvitation;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Support\InvitationUnavailable;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\AcceptStaffInvitationRequest;
use App\Listeners\RecordSuccessfulLogin;
use App\Support\Features;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The page behind the link of the invitation mail, and the form on it (13 §5.9 steps 3-5, 14 §3.4). The routes are
 * public and `signed`; a signature that is wrong or has run out is answered by `Auth/InvitationInvalid` as well
 * (`InvalidInvitationLink`). The invitation is looked up here and not bound, so that an id nobody has is the same page
 * as a bad signature.
 */
final class StaffInvitationController extends Controller
{
    /** Session keys of the Google option (13 §5.9 step 4); `GoogleController` reads and writes the same ones. */
    public const string SESSION_ID = 'invitation.id';

    public const string SESSION_URL = 'invitation.url';

    /** `invitation.google.{invitationId}` is `{id, name}` of the Google account the invitee chose. */
    public const string SESSION_GOOGLE = 'invitation.google';

    public function show(Request $request, string $invitation): Response
    {
        $model = StaffInvitation::query()->find($invitation);

        if (! $model instanceof StaffInvitation) {
            return self::invalid(InvitationUnavailable::INVALID);
        }

        $reason = $this->unavailableReason($model);

        if ($reason !== null) {
            return self::invalid($reason);
        }

        if ($request->user() !== null) {
            return self::invalid('signed_in');
        }

        // The Google button is a plain link to `auth.google.redirect`, which needs both in the session to start.
        $request->session()->put([self::SESSION_ID => $model->id, self::SESSION_URL => $request->fullUrl()]);

        $google = $this->googleChoice($request, $model);

        return Inertia::render('Auth/AcceptInvitation', [
            'invitation' => [
                'email' => $model->email,
                'name' => $model->name,
                'roleLabel' => trans_icu('roles.names.'.$model->role->value),
                'expiresAt' => $model->expires_at->toIso8601String(),
            ],
            'googleEnabled' => Features::enabled('google_login'),
            'prefillName' => ($google['name'] ?? '') === '' ? null : $google['name'],
            'googleConnected' => $google !== null,
            'passwordRules' => Password::defaults()->toPasswordRulesString(),
        ]);
    }

    public function accept(AcceptStaffInvitationRequest $request, string $invitation, AcceptStaffInvitation $accept): Response|RedirectResponse
    {
        $model = StaffInvitation::query()->find($invitation);

        if (! $model instanceof StaffInvitation) {
            return self::invalid(InvitationUnavailable::INVALID);
        }

        // Somebody who is signed in cannot take the invitation: the page asks them to sign out first.
        if ($request->user() !== null) {
            return self::invalid('signed_in');
        }

        try {
            $user = $accept->handle($model, $request->chosenName(), $request->chosenPassword(), $this->googleChoice($request, $model)['id'] ?? null);
        } catch (InvitationUnavailable $unavailable) {
            return self::invalid($unavailable->reason);
        }

        $session = $request->session();

        // The sign-in is recorded as Google's only when the Google account really was linked.
        if ($user->google_id !== null) {
            $session->put(RecordSuccessfulLogin::PENDING_METHOD_KEY, ['method' => 'google', 'user' => $user->getKey()]);
        }

        // Staff never get a remember cookie (13 §6.1).
        Auth::login($user, false);
        $session->regenerate();
        $session->forget([self::SESSION_ID, self::SESSION_URL, self::SESSION_GOOGLE]);

        return redirect()->route('admin.dashboard');
    }

    /** The page for a link that cannot be used, with the reason (`InvitationInvalidProps`, 14 §3.4). */
    public static function invalid(string $reason): Response
    {
        return Inertia::render('Auth/InvitationInvalid', ['reason' => $reason]);
    }

    private function unavailableReason(StaffInvitation $invitation): ?string
    {
        return match (true) {
            $invitation->accepted_at !== null => InvitationUnavailable::ACCEPTED,
            $invitation->revoked_at !== null => InvitationUnavailable::REVOKED,
            $invitation->isExpired() => InvitationUnavailable::EXPIRED,
            default => null,
        };
    }

    /**
     * The Google account the invitee chose for this invitation: the callback left `{id, name}` under the id of the
     * invitation, so a choice made for another one is not found.
     *
     * @return array{id: string, name: string}|null
     */
    private function googleChoice(Request $request, StaffInvitation $invitation): ?array
    {
        $choice = $request->session()->get(self::SESSION_GOOGLE.'.'.$invitation->id);

        if (! is_array($choice) || ! is_string($choice['id'] ?? null) || $choice['id'] === '') {
            return null;
        }

        return ['id' => $choice['id'], 'name' => is_string($choice['name'] ?? null) ? $choice['name'] : ''];
    }
}
