<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Laravel\Fortify\Contracts\PasswordUpdateResponse;
use Symfony\Component\HttpFoundation\Response;

/** After a password change (14 §3.1): back to the page with the toast `account.toasts.password_updated`. */
final class PasswordUpdatedResponse implements PasswordUpdateResponse
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        if ($request->wantsJson()) {
            return new JsonResponse('', 200);
        }

        Inertia::flash('success', trans_icu('account.toasts.password_updated'));

        return back();
    }
}
