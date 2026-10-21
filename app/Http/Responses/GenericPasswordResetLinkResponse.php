<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * The one answer to a request for a reset link (13 §5.5): "If an account exists for that email, we've sent a reset
 * link." The same redirect and status for an address with an account, one without, a user who was asked too soon
 * after the last link, and a request the hourly limit swallowed, so the answer says nothing about the account. Bound
 * for Fortify's success and failure responses alike, which differ only in the status they are given (the broker's
 * word for what happened); that status is ignored, so it never reaches the visitor.
 */
final class GenericPasswordResetLinkResponse implements FailedPasswordResetLinkRequestResponse, SuccessfulPasswordResetLinkRequestResponse
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        $message = trans('passwords.sent_generic');

        return $request->wantsJson()
            ? new JsonResponse(['message' => $message], 200)
            : back()->with('status', $message);
    }
}
