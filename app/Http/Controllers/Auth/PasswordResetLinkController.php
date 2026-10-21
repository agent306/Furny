<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\Http\Controllers\PasswordResetLinkController as FortifyPasswordResetLinkController;
use Laravel\Fortify\Http\Requests\SendPasswordResetLinkRequest;
use Throwable;

/**
 * Fortify's request for a reset link with one change (13 §5.5): when sending the link fails, which is the queue being
 * down (the mail is queued), the failure is reported and the visitor still gets the generic answer. Without that, an
 * address with an account would answer 500 where an unknown one answers the generic status. Only this request is
 * forgiving; other senders of the notification see the failure.
 */
final class PasswordResetLinkController extends FortifyPasswordResetLinkController
{
    public function store(SendPasswordResetLinkRequest $request): Responsable
    {
        if (config('fortify.lowercase_usernames') && $request->has(Fortify::email())) {
            $request->merge([Fortify::email() => Str::lower($request->{Fortify::email()})]);
        }

        try {
            $status = $this->broker()->sendResetLink($request->only(Fortify::email()));
        } catch (Throwable $exception) {
            report($exception);

            $status = Password::RESET_LINK_SENT;
        }

        return $status == Password::RESET_LINK_SENT
            ? app(SuccessfulPasswordResetLinkRequestResponse::class, ['status' => $status])
            : app(FailedPasswordResetLinkRequestResponse::class, ['status' => $status]);
    }
}
