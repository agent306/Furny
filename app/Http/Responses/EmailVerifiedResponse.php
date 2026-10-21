<?php

declare(strict_types=1);

namespace App\Http\Responses;

use App\Support\Auth\IntendedRedirect;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Laravel\Fortify\Contracts\VerifyEmailResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * After the verification link was opened (14 §3.1): the dashboard of the user's kind (or the page they were on) with
 * the toast `account.toasts.email_verified`.
 */
final class EmailVerifiedResponse implements VerifyEmailResponse
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        if ($request->wantsJson()) {
            return new JsonResponse('', 204);
        }

        Inertia::flash('success', trans_icu('account.toasts.email_verified'));

        return IntendedRedirect::response($request);
    }
}
